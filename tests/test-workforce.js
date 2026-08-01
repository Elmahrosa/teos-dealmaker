const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');
const workforce = require('../services/workforce');

(async () => {
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  const tg = 3001;
  await identity.ensureUser(adapter, tg, { display_name: 'Ops Lead' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tg)).id,
    companyName: 'Workforce Co',
    lang: 'en',
    plan: 'growth'
  });

  let view = await workforce.getWorkforceView(adapter, ws.id);
  assert.strictEqual(view.agents.length, 13, '13 agents in view');
  assert.strictEqual(view.today_runs_total, 0, 'no runs yet');
  const prospector = view.agents.find(a => a.agent_type === 'prospecting');
  assert.strictEqual(prospector.label, 'Prospector', 'friendly label');
  assert.strictEqual(prospector.status, 'ready', 'ready after provisioning');

  const run = await workforce.runAgent(adapter, ws.id, 'prospecting', async () => ({
    output: 'Found 58 companies, 21 high-fit',
    cost_cents: 4
  }), { provider: 'test', model: 'test-1', input: 'SMB Egypt market' });

  assert.strictEqual(run.status, 'completed', 'run completed');
  assert.ok(run.runId, 'run recorded');
  assert.strictEqual(run.cost_cents, 4, 'cost captured');

  const agentAfter = await repos.agents.getByWorkspace(ws.id, 'prospecting');
  assert.strictEqual(agentAfter.total_runs, 1, 'total_runs incremented');
  assert.strictEqual(agentAfter.total_cost_cents, 4, 'cost accumulated');
  assert.ok(agentAfter.last_run_at, 'last_run_at set');
  assert.ok(agentAfter.next_run_at, 'next_run_at set');
  assert.ok(agentAfter.next_run_at > agentAfter.last_run_at, 'next_run_at in future');
  assert.strictEqual(agentAfter.status, 'ready', 'returns to ready');

  const runs = await repos.agentRuns.list(ws.id);
  assert.strictEqual(runs.length, 1, 'one run row');
  assert.strictEqual(runs[0].status, 'completed', 'run row completed');
  assert.strictEqual(runs[0].output, 'Found 58 companies, 21 high-fit', 'output stored');
  assert.ok(runs[0].started_at, 'started_at stored');

  await workforce.runAgent(adapter, ws.id, 'prospecting', async () => ({
    output: 'Found 12 more',
    cost_cents: 2
  }));
  const agentAgain = await repos.agents.getByWorkspace(ws.id, 'prospecting');
  assert.strictEqual(agentAgain.total_runs, 2, 'second run increments');
  assert.strictEqual(agentAgain.total_cost_cents, 6, 'cost accumulates');

  await assert.rejects(
    workforce.runAgent(adapter, ws.id, 'outreach', async () => {
      throw new Error('provider down');
    }),
    /provider down/,
    'runAgent surfaces agent errors'
  );
  const outreachAgent = await repos.agents.getByWorkspace(ws.id, 'outreach');
  assert.strictEqual(outreachAgent.status, 'ready', 'agent recovers to ready after error');
  assert.strictEqual(outreachAgent.total_runs, 1, 'failed run still counted');
  const outreachRuns = await repos.agentRuns.list(ws.id);
  const failed = outreachRuns.find(r => r.agent_name === 'outreach');
  assert.strictEqual(failed.status, 'error', 'failed run marked error');

  const activity = await workforce.todayActivity(adapter, ws.id);
  const actProspector = activity.find(a => a.agent_type === 'prospecting');
  const actOutreach = activity.find(a => a.agent_type === 'outreach');
  assert.strictEqual(actProspector.runs, 2, 'activity counts prospector runs');
  assert.strictEqual(actOutreach.runs, 1, 'activity counts outreach runs');
  assert.strictEqual(actProspector.last_output, 'Found 12 more', 'activity latest output');

  const pipeline = await workforce.runPipelineDemo(adapter, ws.id);
  assert.ok(pipeline.deal.id, 'pipeline persisted a deal');
  assert.strictEqual(pipeline.runs.length, 5, 'five agents ran');
  assert.ok(pipeline.closing.status === 'won' || pipeline.closing.status === 'blocked', 'closing outcome');
  const dealStages = await repos.pipeline.list(ws.id, pipeline.deal.id);
  assert.ok(dealStages.length >= 1, 'pipeline events recorded');
  const notes = await repos.dealNotes.list(ws.id, pipeline.deal.id);
  assert.strictEqual(notes.length, 5, 'five collaboration notes');
  assert.deepStrictEqual(
    notes.map(n => n.agent_name),
    ['strategist', 'marketer', 'negotiator', 'treasurer', 'closing'],
    'collaboration chain in order'
  );
  assert.ok(notes.every(n => typeof n.note === 'string' && n.note.length > 0), 'notes have content');
  const updatedCtx = await identity.getWorkspaceForUser(adapter, (await identity.getUserByTelegram(adapter, tg)).id);
  assert.strictEqual(updatedCtx.id, ws.id, 'workspace intact after pipeline');

  const tgB = 3002;
  await identity.ensureUser(adapter, tgB);
  const wsB = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tgB)).id,
    companyName: 'Beta Workforce',
    lang: 'en',
    plan: 'solo'
  });
  const viewB = await workforce.getWorkforceView(adapter, wsB.id);
  assert.strictEqual(viewB.today_runs_total, 0, 'second workspace has no runs');
  const activityB = await workforce.todayActivity(adapter, wsB.id);
  assert.strictEqual(activityB.find(a => a.agent_type === 'prospecting').runs, 0, 'activity isolated per workspace');

  const dealCountA = (await repos.deals.list(ws.id, {})).length;
  const dealCountB = (await repos.deals.list(wsB.id, {})).length;
  assert.ok(dealCountA >= 1, 'workspace A has the pipeline deal');
  assert.strictEqual(dealCountB, 0, 'workspace B deals isolated');

  console.log(`\n✓ ai workforce (${38} assertions passed)`);
  console.log(`  ${view.agents.length} agents · prospector runs ${actProspector.runs} · cost $${(agentAgain.total_cost_cents / 100).toFixed(2)} · pipeline deal #${pipeline.deal.id}`);
  process.exit(0);
})().catch(err => {
  console.error('✗ workforce test failed:', err);
  process.exit(1);
});
