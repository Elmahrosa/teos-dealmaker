const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');
const planner = require('../services/workforce/planner');
const scheduler = require('../services/workforce/scheduler');
const dispatcher = require('../services/workforce/dispatcher');
const reviewer = require('../services/workforce/reviewer');
const approvals = require('../services/workforce/approvals');
const confidence = require('../services/workforce/confidence');
const optimizer = require('../services/workforce/optimizer');
const recovery = require('../services/workforce/recovery');
const telemetry = require('../services/workforce/telemetry');
const events = require('../services/workforce/events');
const runtime = require('../services/workforce/runtime');
const { EVENT_NAMES } = require('../services/workforce/events');

(async () => {
  let n = 0;
  const check = (cond, msg) => { assert.ok(cond, msg); n += 1; };
  const equal = (a, b, msg) => { assert.strictEqual(a, b, msg); n += 1; };

  const adapter = createMemoryAdapter();
  const tg = 7700001;
  await identity.ensureUser(adapter, tg, { display_name: 'Runtime Founder' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tg)).id,
    companyName: 'Autonomous Runtime',
    lang: 'en',
    plan: 'growth'
  });
  const wsId = ws.id;
  const repos = createRepos(adapter);

  // Activate subscription for growth plan (simulate webhook)
  const sub = await repos.subscriptions.get(wsId);
  await repos.subscriptions.update(sub.id, { status: 'active' });

  equal(typeof events.emit, 'function', 'events bus exposes emit');
  const heard = [];
  const off = events.on(EVENT_NAMES.TASK_COMPLETED, p => heard.push(p));
  events.emit(EVENT_NAMES.TASK_COMPLETED, { stepId: 1 });
  equal(heard.length, 1, 'event listener receives payload');
  off();
  events.emit(EVENT_NAMES.TASK_COMPLETED, { stepId: 2 });
  equal(heard.length, 1, 'off() stops the listener');

  equal(planner.intentOf('Run a cold email campaign for fintech CFOs'), 'outreach', 'outreach intent detected');
  equal(planner.intentOf('Research Acme Corp and build a company profile'), 'research', 'research intent detected');
  equal(planner.intentOf('Prepare and send a proposal to the target'), 'proposal', 'proposal intent detected');
  equal(planner.intentOf('Close the deal and prepare the contract'), 'deal', 'deal intent detected');
  equal(planner.intentOf('Something generic to think about'), 'general', 'general fallback intent');

  const dealPlan = planner.planGoal('Close the deal for Acme Corp', {});
  check(dealPlan.steps.length >= 6, 'deal plan has a full pipeline');
  check(dealPlan.steps.every(s => s.provider && s.model), 'every planned step is provider-stamped');
  equal(dealPlan.steps.every(s => s.simulated === true), true, 'no keys configured → steps simulated');

  const researchSteps = planner.planGoal('Research Acme Corp', {}).steps;
  const mergeStep = researchSteps.find(s => s.agent_type === 'intelligence');
  check(mergeStep.depends_on.length === 2, 'synthesis step depends on both parallel branches');
  const parallelGroup = researchSteps.filter(s => s.step_group === 'parallel');
  check(parallelGroup.length === 2, 'two steps share a parallel group');

  const q = scheduler.createQueue();
  q.push({ id: 1, priority: 'research' });
  q.push({ id: 2, priority: 'critical' });
  q.push({ id: 3, priority: 'cleanup' });
  q.push({ id: 4, priority: 'revenue' });
  equal(q.next().id, 2, 'critical pops first');
  equal(q.next().id, 4, 'revenue pops second');
  equal(q.next().id, 1, 'research pops before cleanup');
  equal(q.next().id, 3, 'cleanup pops last');
  equal(q.size(), 0, 'queue drains');
  equal(scheduler.priorityRank('critical') < scheduler.priorityRank('cleanup'), true, 'critical outranks cleanup');
  equal(scheduler.priorityRank('normal') > scheduler.priorityRank('cleanup'), true, 'normal below cleanup');

  const ready = scheduler.readySteps([
    { id: 1, step_key: 'a', status: 'completed' },
    { id: 2, step_key: 'b', status: 'pending', depends_on: ['a'] },
    { id: 3, step_key: 'c', status: 'pending', depends_on: ['a'] },
    { id: 4, step_key: 'd', status: 'pending', depends_on: ['z'] },
    { id: 5, step_key: 'e', status: 'pending' }
  ], ['a']);
  equal(ready.length, 3, 'ready steps exclude blocked ones');
  check(ready.every(s => s.id !== 4), 'step blocked by missing dependency excluded');

  const dispatch = dispatcher.dispatch({ agentType: 'negotiator' });
  check(dispatch.provider && dispatch.model, 'dispatcher returns provider + model');
  equal(dispatch.simulated, true, 'no configured provider → simulated');
  check(dispatcher.concurrencyFor('research') >= 3, 'research allowed parallel concurrency');
  check(dispatcher.retryPolicyFor('treasurer').maxRetries >= 3, 'treasurer retry policy is stricter');
  const explicit = dispatcher.dispatch({ agentType: 'negotiator', opts: { provider: 'anthropic', model: 'claude-sonnet-4-5' } });
  equal(explicit.provider, 'anthropic', 'explicit provider honored');
  equal(explicit.model, 'claude-sonnet-4-5', 'explicit model honored');

  const opt = optimizer.optimize({ agentType: 'research', quality: 'cheap' });
  check(opt.provider === 'gemini' || opt.provider === 'openai', 'cost optimizer picks a cheap research model');
  check(optimizer.estimateCostCents('openai', 'gpt-4o-mini', 1000) > 0, 'cost estimator returns a number');

  equal(confidence.evaluate({ review: { score: 95, decision: 'approve' }, simulated: true }).confidence > 0.6, true, 'reviewed simulated output keeps decent confidence');
  const low = confidence.evaluate({ review: { score: 10, decision: 'reject' }, simulated: true });
  equal(confidence.needsApproval(low.confidence), true, 'low-confidence result needs human approval');
  const high = confidence.evaluate({ review: { score: 95, decision: 'approve' }, simulated: false });
  equal(high.label, 'high', 'live reviewed result labelled high');
  equal(confidence.needsApproval(high.confidence), false, 'high confidence auto-approves');

  const good = reviewer.heuristicScore({ task: 'Prepare the proposal with pricing terms and discount schedule for the deal.' }, 'Comprehensive analysis. Recommended action: add the target to the pipeline for immediate scoring and route the lead to the qualification queue.\n\nConfidence 88%. Estimated impact: +30% pipeline contribution. Figures: $12,500 target pricing with 10% discount ceiling. Next steps are to negotiate terms and prepare the checkout.');
  equal(good.decision, 'approve', 'well-formed output approved');
  const bad = reviewer.heuristicScore({ task: 'Prepare the proposal' }, 'nope');
  equal(bad.decision, 'reject', 'sparse output rejected');
  check(bad.failures.includes('data'), 'reject explains missing data');

  check(approvals.requiresApproval({ agent_type: 'outreach', task: 'Send the proposal to the target. Requires founder approval.' }), true, 'sending a proposal requires approval');
  check(approvals.requiresApproval({ agent_type: 'treasurer', task: 'Issue a refund to the customer.' }), true, 'issuing a refund requires approval');
  check(approvals.requiresApproval({ agent_type: 'treasurer', task: 'Prepare the contract and checkout for the deal.' }) === false, 'preparing a contract does not require approval');
  check(approvals.requiresApproval({ agent_type: 'intelligence', task: 'Answer the question from company knowledge.' }) === false, 'read-only research does not require approval');
  equal(approvals.gatesFor({ agent_type: 'outreach', task: 'Send the proposal to the target.' })[0], 'send_proposal', 'gate action identified');

  let retried = 0;
  let attempt = 0;
  const value = await recovery.withRetry(async (current) => {
    attempt = current;
    retried += 1;
    if (retried < 3) throw new Error('transient');
    return 'ok';
  }, { maxRetries: 2, backoffMs: 1 });
  equal(value, 'ok', 'withRetry recovers from transient failures');
  equal(attempt, 3, 'recovered on third attempt');
  await assert.rejects(
    recovery.withRetry(async () => { throw new Error('permanent'); }, { maxRetries: 1, backoffMs: 1 }),
    /permanent/,
    'withRetry throws after exhausting retries'
  );
  const esc = recovery.escalationLevel(3, { provider: 'anthropic', retryPolicy: { maxRetries: 2 } });
  equal(esc.level, 'escalate_human', 'recovery escalates to a human after retries');

  const summaryPlan = await runtime.runGoal(adapter, wsId, 'Research Acme Corp and build a company profile', { title: 'Acme research' });
  equal(summaryPlan.status, 'completed', 'research goal completes autonomously');
  check(summaryPlan.steps.every(s => s.status === 'completed'), 'all research steps completed');
  check(summaryPlan.briefing.includes('Executive briefing'), 'briefing generated');
  check(summaryPlan.telemetry.completed >= summaryPlan.steps.length, 'telemetry counts plan runs');
  check(summaryPlan.steps.every(s => typeof s.confidence === 'number'), 'every step carries a confidence score');
  check(summaryPlan.steps.every(s => s.review && typeof s.review.score === 'number'), 'every step was reviewed');
  const mem = await repos.memory.get(wsId, `plan_${summaryPlan.plan.id}`);
  check(mem && mem.value.includes('Acme research'), 'memory updated with plan outcome');
  const docs = await repos.intelligence.list(wsId, 'plan');
  check(docs.length >= 1, 'plan knowledge document stored for intelligence');

  const dealOutcome = await runtime.runGoal(adapter, wsId, 'Close the deal for Acme Corp', { title: 'Acme deal' });
  equal(dealOutcome.status, 'completed', 'deal goal completes the full pipeline');
  check(dealOutcome.steps.some(s => s.agent_type === 'treasurer' && s.status === 'completed'), 'treasurer finalized the deal');

  const proposalOutcome = await runtime.runGoal(adapter, wsId, 'Prepare and send a proposal to Acme Corp', { title: 'Acme proposal' });
  equal(proposalOutcome.status, 'waiting_approval', 'proposal halts for founder approval');
  equal(proposalOutcome.pendingApprovals.length, 1, 'one approval request pending');
  const pending = proposalOutcome.pendingApprovals[0];
  const waitingStep = proposalOutcome.steps.find(s => s.status === 'awaiting_approval');
  check(waitingStep && waitingStep.approval, 'awaiting step records approval metadata');
  const list = await repos.approvals.list(wsId, 'pending');
  equal(list.length, 1, 'approval request persisted as pending');

  let refused = false;
  try {
    await approvals.decide(adapter, wsId, pending.requestId, 'approve', 99);
    await approvals.decide(adapter, wsId, pending.requestId, 'approve', 99);
  } catch (err) {
    refused = err.message.includes('already');
  }
  check(refused, 'second decision on a settled request is refused');

  const resumed = await runtime.resume(adapter, wsId, proposalOutcome.plan.id);
  equal(resumed.status, 'completed', 'plan resumes and completes after approval');
  equal(resumed.steps.find(s => s.step_key === 'send').status, 'completed', 'approved send step completes');

  const rejectedPlan = await runtime.runGoal(adapter, wsId, 'Prepare and send a proposal to Globex', { title: 'Globex proposal' });
  const rejectedApproval = rejectedPlan.pendingApprovals[0];
  const rejected = await runtime.approveAndResume(adapter, wsId, rejectedApproval.requestId, 1);
  equal(rejected.decision.status, 'approved', 'approveAndResume approves a pending request');
  equal(rejected.status, 'completed', 'approveAndResume completes the plan');
  equal(rejected.steps.find(s => s.step_key === 'send').status, 'completed', 'approved send step runs');

  const rejectedPlan2 = await runtime.runGoal(adapter, wsId, 'Prepare and send a proposal to Initech', { title: 'Initech proposal' });
  const rejectedApproval2 = rejectedPlan2.pendingApprovals[0];
  await approvals.decide(adapter, wsId, rejectedApproval2.requestId, 'reject', 1);
  const rejectedResumed = await runtime.resume(adapter, wsId, rejectedPlan2.plan.id);
  equal(rejectedResumed.status, 'completed', 'rejected step is skipped and plan completes');
  equal(rejectedResumed.steps.find(s => s.step_key === 'send').status, 'skipped', 'rejected step skipped');

  const snap = await telemetry.snapshot(adapter, wsId);
  check(snap.runs >= 10, 'telemetry snapshot aggregates runs');
  check(snap.totalCostCents >= 0, 'telemetry aggregates cost');
  check(Object.keys(snap.byProvider).length >= 1, 'telemetry buckets runs by provider');

  const plans = await repos.plans.list(wsId);
  check(plans.length >= 5, 'multiple plans persisted');

  events.clear();
  console.log(`\n✓ autonomous workforce runtime (${n} assertions passed)`);
  console.log('  planner·scheduler·dispatcher·executor·reviewer·approvals·confidence·optimizer·recovery·telemetry·runtime');
})().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});

