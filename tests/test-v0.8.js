const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const identity = require('../services/identity');
const learning = require('../services/learning');
const revenueStrategist = require('../agents/revenueStrategist');
const runtime = require('../services/workforce/runtime');
const planner = require('../services/workforce/planner');
const intelligence = require('../services/intelligence');
const memory = require('../services/memory');

(async () => {
  const adapter = createMemoryAdapter();
  const tg = 8001;
  await identity.ensureUser(adapter, tg, { display_name: 'Founder' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tg)).id,
    companyName: 'TEOS Dealmaker',
    lang: 'en',
    plan: 'growth'
  });

  console.log('\n=== v0.8 · Learning wizard + Mission UX ===');

  // 1. Learn-first gating: nothing recorded → incomplete, gaps present.
  let before = await learning.progress(adapter, ws.id);
  assert.strictEqual(before.complete, false, 'mission 0 not complete before learning');
  assert.ok((await learning.validate(adapter, ws.id)).gaps.length > 0, 'gaps before learning');

  // 2. Incremental answers persist immediately (per-answer record).
  await learning.record(adapter, ws.id, { section: 'company', key: 'company_name', value: 'TEOS Dealmaker' });
  let mid = await learning.getKnowledge(adapter, ws.id);
  assert.strictEqual(mid.company.company_name, 'TEOS Dealmaker', 'incremental save: company name persisted');

  // 3. Complete required knowledge.
  await learning.record(adapter, ws.id, { section: 'company', key: 'problem', value: 'SMBs waste time running AI sales teams manually' });
  await learning.record(adapter, ws.id, { section: 'company', key: 'products', value: 'TEOS Dealmaker SaaS' });
  await learning.record(adapter, ws.id, { section: 'company', key: 'ideal_customer', value: 'B2B SaaS, AI startups' });
  await learning.record(adapter, ws.id, { section: 'company', key: 'competitors', value: 'Clay, Artisan' });
  await learning.record(adapter, ws.id, { section: 'company', key: 'differentiator', value: 'A mission-driven revenue team, not a tool' });
  await learning.record(adapter, ws.id, { section: 'company', key: 'pitch', value: 'The AI revenue workforce for B2B SaaS.' });

  await learning.record(adapter, ws.id, { section: 'product', key: 'name', value: 'TEOS Dealmaker SaaS', context: 'TEOS Dealmaker SaaS' });
  await learning.record(adapter, ws.id, { section: 'product', key: 'price', value: '$99/month', context: 'TEOS Dealmaker SaaS' });
  await learning.record(adapter, ws.id, { section: 'product', key: 'target_customer', value: 'Founders and sales leads', context: 'TEOS Dealmaker SaaS' });
  await learning.record(adapter, ws.id, { section: 'product', key: 'benefits', value: 'Autonomous missions, approvals, pipeline', context: 'TEOS Dealmaker SaaS' });
  await learning.record(adapter, ws.id, { section: 'product', key: 'objections', value: 'It is too automated', context: 'TEOS Dealmaker SaaS' });

  await learning.record(adapter, ws.id, { section: 'playbook', key: 'who_buys', value: 'Founders and heads of sales' });
  await learning.record(adapter, ws.id, { section: 'playbook', key: 'why_buy', value: 'They want revenue without headcount' });

  await learning.record(adapter, ws.id, { section: 'persona', key: 'name', value: 'Founder', context: 'Founder' });
  await learning.record(adapter, ws.id, { section: 'persona', key: 'budget_authority', value: 'Yes', context: 'Founder' });
  await learning.record(adapter, ws.id, { section: 'persona', key: 'pain_points', value: 'No time to run outreach at scale', context: 'Founder' });

  // 4. Progress now complete; validation has no required gaps.
  const after = await learning.progress(adapter, ws.id);
  assert.strictEqual(after.complete, true, 'mission 0 complete after learning');
  assert.strictEqual(after.products, 1, 'one product learned');
  assert.strictEqual(after.personas, 1, 'one persona learned');
  assert.strictEqual(after.pct, 100, '100% progress');
  const v = await learning.validate(adapter, ws.id);
  assert.strictEqual(v.complete, true, 'validation passes');

  // 5. Answers flow into shared memory the workforce reads.
  const mem = await memory.getMemory(adapter, ws.id);
  assert.strictEqual(mem.company_name, 'TEOS Dealmaker', 'memory company_name synced');
  assert.ok(Array.isArray(mem.products) && mem.products.includes('TEOS Dealmaker SaaS'), 'memory products synced');
  assert.ok(mem.icp.industries.includes('B2B SaaS'), 'memory ICP synced');
  assert.ok(mem.brand_voice, 'memory brand voice synced');
  assert.ok(mem.sales_playbook, 'memory sales playbook synced');

  // 6. Answers indexed into the knowledge engine.
  const docs = await intelligence.listDocuments(adapter, ws.id);
  assert.ok(docs.length >= 8, 'knowledge documents created from learning answers');

  // 7. Revenue Strategist assessment grounded in knowledge.
  const knowledge = await learning.getKnowledge(adapter, ws.id);
  const assessment = revenueStrategist.evaluateMission('Close our first ten customers', knowledge);
  assert.strictEqual(assessment.makesSense, true, 'mission makes sense with knowledge');
  assert.ok(assessment.specialists.length > 0, 'specialists selected');
  assert.strictEqual(assessment.requiresHumanApproval, true, 'close mission requires human approval');
  assert.ok(assessment.budgetCents > 0, 'budget set');
  const strategy = revenueStrategist.buildSalesStrategy(knowledge);
  assert.ok(strategy.pricing.length === 1 && strategy.pricing[0].name === 'TEOS Dealmaker SaaS', 'pricing grounded in products');
  assert.ok(strategy.ascii.includes('SALES STRATEGY'), 'ascii strategy present');

  // 8. Planner: every mission starts with the Revenue Strategist.
  for (const goal of ['Close this deal', 'Send a proposal', 'Run cold email outreach', 'Research competitors', 'Score this lead', 'General thing']) {
    const plan = planner.planGoal(goal);
    assert.strictEqual(plan.steps[0].agent_type, 'revenue_strategist', `assess step first for "${goal}"`);
    assert.strictEqual(plan.steps[0].step_key, 'assess', 'assess step key');
    assert.strictEqual(plan.steps[0].priority, 1, 'revenue strategist runs first');
  }

  // 9. Mission 1 (Sell TEOS Dealmaker) runs and pauses for founder approval.
  const mission = await runtime.runSalesStrategy(adapter, ws.id, {});
  assert.strictEqual(mission.plan.title, 'Sell TEOS Dealmaker', 'mission 1 title');
  assert.strictEqual(mission.status, 'waiting_approval', 'pauses for approval before presenting');
  assert.strictEqual(mission.pendingApprovals.length, 1, 'one pending approval');
  assert.strictEqual(mission.steps.length, 6, 'six steps in the strategy mission');
  const presentStep = mission.steps.find(s => s.step_key === 'present');
  assert.strictEqual(presentStep.status, 'awaiting_approval', 'present step gates on approval');
  assert.ok(mission.strategy.ascii, 'strategy briefing returned');

  // 10. Founder approval resumes the mission to completion.
  const resumed = await runtime.approveAndResume(adapter, ws.id, mission.pendingApprovals[0].requestId, tg);
  assert.strictEqual(resumed.status, 'completed', 'mission completes after approval');
  const presentAfter = resumed.steps.find(s => s.step_key === 'present');
  assert.strictEqual(presentAfter.status, 'completed', 'present step completed after approval');

  // 11. Budget mechanism halts when spend exceeds budget.
  const { createRepos } = require('../db/repos');
  const budgeted = await runtime.runGoal(adapter, ws.id, 'Research our competitors and explain how we win', { title: 'Budget capped', budgetCents: 1 });
  const brepos = createRepos(adapter);
  const seeded = await brepos.agentRuns.start({ workspace_id: ws.id, plan_id: budgeted.plan.id, agent_name: 'market_intelligence', provider: 'openai', model: 'gpt-4o-mini' });
  await brepos.agentRuns.complete(ws.id, seeded.id, { status: 'completed', cost_cents: 500 });
  const halted = await runtime.resume(adapter, ws.id, budgeted.plan.id);
  assert.strictEqual(halted.status, 'budget_exceeded', 'budget exceeded halts mission');

  // 12. Missions surface in the Mission Center listing.
  const missions = await runtime.listMissions(adapter, ws.id);
  assert.ok(missions.length >= 2, 'missions listed in Mission Center');
  const m1 = missions.find(m => m.title === 'Sell TEOS Dealmaker');
  assert.strictEqual(m1.status, 'completed', 'mission 1 shown completed');
  assert.strictEqual(m1.awaiting_approval, 0, 'no pending approvals left');

  console.log(`✓ v0.8 mission + learning suite (${13} assertions passed)`);
  console.log('  learn-first gating · incremental saves · memory sync · knowledge indexing · revenue strategist · planner assess step · mission 1 approve/resume · budget halt · mission center');
})().catch(err => {
  console.error('✗ v0.8 test failed:', err);
  process.exit(1);
});
