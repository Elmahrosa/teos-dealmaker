const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const identity = require('../services/identity');
const mc = require('../services/mission-controller');
const { schema, validate, planner, coordinator, state } = mc;

(async () => {
  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };

  console.log('\n=== mission-controller scaffolding ===');

  // --- schema & validation ---
  const good = {
    title: 'Close first ten customers',
    goal: 'Close our first ten customers',
    intent: 'deal',
    priority: 'high',
    budgetCents: 500,
    steps: [
      { step_key: 'assess', agent_type: 'revenue_strategist', task: 'Assess the mission', priority: 1 },
      { step_key: 'close', agent_type: 'treasurer', task: 'Close the deal', depends_on: ['assess'] }
    ]
  };
  ok(validate(good).valid, 'valid mission passes validation');
  ok(!validate({}).valid, 'empty mission invalid');
  ok(!validate({ ...good, title: '' }).valid, 'missing title invalid');
  ok(!validate({ ...good, goal: '' }).valid, 'missing goal invalid');
  ok(!validate({ ...good, steps: [] }).valid, 'empty steps invalid');
  ok(!validate({ ...good, steps: [good.steps[0], good.steps[0]] }).valid, 'duplicate step_key invalid');
  ok(!validate({ ...good, steps: [{ step_key: 'x', agent_type: 'not_a_real_agent', task: 't' }] }).valid, 'unknown agent_type invalid');
  ok(!validate({ ...good, steps: [{ step_key: 'x', agent_type: 'treasurer', task: 't', depends_on: ['missing'] }] }).valid, 'unknown depends_on reference invalid');
  ok(!validate({ ...good, steps: [{ step_key: 'x', agent_type: 'treasurer', task: 't', step_group: 'round' }] }).valid, 'invalid step_group rejected');
  ok(!validate({ ...good, intent: 'nonsense' }).valid, 'invalid intent rejected');
  ok(!validate({ ...good, budgetCents: -5 }).valid, 'negative budget rejected');
  ok(schema.knownAgentTypes().has('intelligence'), 'known agent types include runtime-only agents');
  ok(schema.MISSION_LIFECYCLE.includes('budget_exceeded'), 'lifecycle covers budget_exceeded');

  // --- planner (delegates step generation to the workforce planner) ---
  const p = planner.planMission('Close this deal for Acme');
  ok(p.valid, 'planMission from goal is valid');
  ok(p.mission.steps.length > 0, 'planned mission has steps');
  ok(p.mission.steps[0].agent_type === 'revenue_strategist', 'assess step runs first');
  ok(p.mission.steps[0].step_key === 'assess', 'assess step key');
  ok(p.mission.intent === 'deal', 'intent detected from goal');
  ok(p.mission.status === 'proposed', 'planned mission starts as proposed');
  ok(validate(p.mission).valid, 'planned mission satisfies the schema');
  const gp = planner.planMission('');
  ok(!gp.valid, 'planMission rejects empty goal');
  const sp = planner.withSteps(good);
  ok(sp.valid && sp.mission.steps.length === 2, 'withSteps accepts explicit steps');
  const badSp = planner.withSteps({ steps: [] });
  ok(!badSp.valid, 'withSteps rejects empty steps');

  // --- state machine ---
  ok(state.canTransition('proposed', 'planned'), 'proposed -> planned allowed');
  ok(state.canTransition('planned', 'running'), 'planned -> running allowed');
  ok(state.canTransition('running', 'waiting_approval'), 'running -> waiting_approval allowed');
  ok(state.canTransition('waiting_approval', 'running'), 'approval resumes to running');
  ok(state.canTransition('paused', 'running'), 'paused -> running allowed');
  ok(!state.canTransition('completed', 'running'), 'terminal completed cannot rerun');
  ok(!state.canTransition('proposed', 'running'), 'proposed cannot skip planning');
  ok(!state.canTransition('failed', 'completed'), 'terminal failed cannot recover');
  assert.throws(() => state.assertTransition('completed', 'running'), 'assertTransition throws on illegal move');

  state.begin(1, { status: 'planned', mission: p.mission });
  state.transition(1, 'running');
  state.transition(1, 'waiting_approval');
  state.transition(1, 'running');
  state.transition(1, 'completed');
  ok(state.status(1) === 'completed', 'state reached completed');
  ok(state.snapshot(1).transitions.length === 4, 'four transitions recorded');
  ok(state.list().length >= 1, 'registry lists missions');

  const seen = [];
  const off = state.onTransition(e => seen.push(e));
  state.begin(2, { status: 'planned' });
  state.transition(2, 'running', { note: 'test' });
  ok(seen.length === 1 && seen[0].to === 'running' && seen[0].meta.note === 'test', 'transition listeners fire with meta');
  off();
  state.transition(2, 'paused');
  ok(seen.length === 1, 'listener removed after off()');
  state.reset();
  ok(state.list().length === 0, 'reset clears registry');

  // --- coordinator (delegates execution to the workforce facade) ---
  const adapter = createMemoryAdapter();
  const tg = 9001;
  await identity.ensureUser(adapter, tg, { display_name: 'MC Tester' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tg)).id,
    companyName: 'Mission Co',
    lang: 'en',
    plan: 'growth'
  });

  const launched = await coordinator.launch(adapter, ws.id, 'Research our competitors and explain how we win');
  ok(launched.plan && launched.plan.id, 'launch returns a plan');
  ok(['completed', 'failed', 'waiting_approval', 'budget_exceeded'].includes(launched.status), 'launch reached a terminal state');

  const listed = await coordinator.list(adapter, ws.id);
  ok(listed.length >= 1, 'list returns missions');
  const st = await coordinator.status(adapter, ws.id, launched.plan.id);
  ok(st && st.id === launched.plan.id, 'status finds the mission');

  const paused = await coordinator.pause(adapter, ws.id, launched.plan.id);
  ok(paused.paused || ['completed', 'failed'].includes(paused.plan.status), 'pause handled (already terminal is fine)');
  const resumed = await coordinator.resume(adapter, ws.id, launched.plan.id);
  ok(resumed && resumed.plan, 'resume handled');

  const custom = await coordinator.launch(adapter, ws.id, {
    title: 'Custom two-step',
    goal: 'Run a two-step research mission',
    steps: [
      { step_key: 'assess', agent_type: 'revenue_strategist', task: 'Assess the custom mission' },
      { step_key: 'finish', agent_type: 'treasurer', task: 'Finalize the custom mission', depends_on: ['assess'] }
    ]
  });
  ok(custom.plan && custom.plan.id, 'launch with explicit steps works');

  let threw = false;
  try { await coordinator.launch(adapter, ws.id, { goal: '' }); } catch (_) { threw = true; }
  ok(threw, 'invalid launch is rejected');

  console.log(`✓ mission-controller scaffolding (${passed} assertions passed)`);
  console.log('  schema · validation · planner delegation · state machine · coordinator delegation');
  process.exit(0);
})().catch(err => {
  console.error('✗ mission-controller test failed:', err);
  process.exit(1);
});
