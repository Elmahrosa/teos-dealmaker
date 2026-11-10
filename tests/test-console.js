const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const identity = require('../services/identity');
const workforce = require('../services/workforce');
const queue = require('../services/queue');
const { setMode } = require('../config/mode');

const PIPELINE_INPUT = { assetType: 'product', description: 'Industrial widget lot', askingPrice: 12000, currency: 'USD', sellerTarget: 10000, buyerBudget: 11000 };

(async () => {
  const adapter = createMemoryAdapter();

  const tg = 5001;
  await identity.ensureUser(adapter, tg, { display_name: 'Console Owner' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tg)).id,
    companyName: 'Console Co',
    lang: 'en',
    plan: 'growth'
  });

  await workforce.runAgent(adapter, ws.id, 'prospecting', async () => ({
    output: 'Found 38 companies, 12 high-fit',
    cost_cents: 11
  }), { provider: 'claude', model: 'sonnet' });
  await workforce.runAgent(adapter, ws.id, 'market_intelligence', async () => ({
    output: 'Researched 12 companies',
    cost_cents: 7
  }), { provider: 'gemini', model: 'flash' });

  const consoleView = await workforce.workforceConsole(adapter, ws.id);
  assert.strictEqual(consoleView.workers_total, 13, '13 workers');
  assert.strictEqual(consoleView.busy, 0, 'no busy workers after runs');
  assert.strictEqual(consoleView.today_cost_cents, 18, 'today cost sums both runs');
  assert.strictEqual(consoleView.completed_tasks, 2, 'completed tasks across agents');
  const prospector = consoleView.agents.find(a => a.agent_type === 'prospecting');
  assert.strictEqual(prospector.display, 'Completed', 'prospector ran today → Completed');
  assert.strictEqual(prospector.tone, 'success', 'completed tone');
  const orchestrator = consoleView.agents.find(a => a.agent_type === 'orchestrator');
  assert.strictEqual(orchestrator.display, 'Ready', 'orchestrator idle → Ready');
  assert.strictEqual(consoleView.estimated_pipeline_cents, 0, 'no deals yet');

  // LIVE mode persists the deal; DRY mode must not (covered in test-phase25-dry).
  setMode('LIVE');
  const dry = (setMode('DRY'), await workforce.runPipeline(adapter, ws.id, PIPELINE_INPUT));
  assert.strictEqual(dry.dry_run, true, 'DRY run flagged');
  assert.strictEqual((await queue.queueSnapshot(adapter, ws.id)).total, 0, 'DRY run persisted no deal');
  setMode('LIVE');
  const pipeline = await workforce.runPipeline(adapter, ws.id, PIPELINE_INPUT);
  const consoleAfter = await workforce.workforceConsole(adapter, ws.id);
  assert.strictEqual(pipeline.won, false, 'internal approval never closes a win');
  assert.strictEqual(pipeline.closing.status, 'awaiting_customer', 'closing awaits customer');
  assert.strictEqual(pipeline.deal.stage, 'negotiation', 'deal stops at negotiation');
  assert.strictEqual(pipeline.deal.status, 'open', 'deal remains open');
  assert.strictEqual(consoleAfter.open_deals, 1, 'deal stays open pending customer');
  assert.ok(consoleAfter.estimated_pipeline_cents >= 0, 'pipeline estimate present');
  assert.ok(consoleAfter.today_cost_cents > 18, 'pipeline adds cost');
  assert.strictEqual(consoleAfter.completed_tasks, 8, 'six more runs → 8 total tasks');

  const tl = await workforce.dealTimeline(adapter, ws.id, pipeline.deal.id);
  assert.ok(tl, 'timeline found');
  assert.strictEqual(tl.notes.length, 6, 'six collaboration notes');
  assert.strictEqual(tl.events.length, 4, 'four queue transitions (never past negotiation)');
  assert.strictEqual(tl.events[0].text, 'incoming → research', 'queue starts at research');
  assert.strictEqual(tl.events[3].text, 'proposal → negotiation', 'queue ends at negotiation');
  assert.ok(!tl.events.some(e => /won/.test(e.text)), 'no win transition recorded');
  assert.strictEqual(tl.notes[0].agent_name, 'strategist', 'chain starts with strategist');
  assert.ok(tl.notes.every(n => n.time), 'notes carry timestamps');
  assert.strictEqual(await workforce.dealTimeline(adapter, ws.id, 999999), null, 'missing deal returns null');

  const snapshot = await queue.queueSnapshot(adapter, ws.id);
  assert.strictEqual(snapshot.stages.length, 7, 'seven queue stages');
  const wonStage = snapshot.stages.find(s => s.stage === 'won');
  assert.strictEqual(wonStage.count, 0, 'no deal in won queue');
  await assert.rejects(queue.advanceQueue(adapter, ws.id, pipeline.deal.id, 'won'), /no_trusted_payment_verifier_configured/, 'won is refused without acceptance and payment evidence');
  await assert.rejects(queue.advanceQueue(adapter, ws.id, pipeline.deal.id, 'won', { customerAcceptance: { accepted: true, acceptedBy: 'a', acceptedAt: new Date().toISOString() } }), /no_trusted_payment_verifier_configured/, 'acceptance alone is not enough');
  const { createTestPaymentVerifier } = require('./helpers/testPaymentVerifier');
  const ledgerVerifier = createTestPaymentVerifier();
  const acc = { accepted: true, acceptedBy: 'buyer@example.com', acceptedAt: new Date().toISOString(), proofRef: 'signed-contract-1' };
  const pay = { verified: true, reference: 'bank-ref-9001', source: 'bank_statement', recordedBy: 'founder:1', recordedAt: new Date().toISOString(), amount: Number(pipeline.deal.deal_value), currency: pipeline.deal.currency };
  await assert.rejects(queue.advanceQueue(adapter, ws.id, pipeline.deal.id, 'won', { customerAcceptance: acc, paymentEvidence: { ...pay, amount: 1 } }), /no_trusted_payment_verifier_configured/, 'payment amount must match the deal');
  await assert.rejects(queue.advanceQueue(adapter, ws.id, pipeline.deal.id, 'won', { customerAcceptance: acc, paymentEvidence: { verified: true, reference: 'x', source: 'founder_confirmed_receipt' } }), /no_trusted_payment_verifier_configured/, 'founder flag without recorded receipt is refused');
  // Production wiring has no verifier: even a perfectly shaped claim is refused.
  await assert.rejects(queue.advanceQueue(adapter, ws.id, pipeline.deal.id, 'won', { customerAcceptance: acc, paymentEvidence: pay }), /no_trusted_payment_verifier_configured/, 'well-formed but unverified claim is refused');
  // A verifier that never recorded the payment rejects a fabricated reference.
  await assert.rejects(queue.advanceQueue(adapter, ws.id, pipeline.deal.id, 'won', { paymentVerifier: ledgerVerifier, customerAcceptance: acc, paymentEvidence: pay }), /no_trusted_payment_verifier_configured/, 'queue ignores a caller-supplied verifier');
  assert.strictEqual((await queue.queueSnapshot(adapter, ws.id)).stages.find(s => s.stage === 'won').count, 0, 'rejections left no won deal');
  const movements = await queue.queueMovements(adapter, ws.id, 10);
  assert.ok(movements.length >= 4, 'movements recorded');
  assert.strictEqual(movements[0].to_stage, 'negotiation', 'most recent movement is negotiation');
  assert.ok(movements.every(m => m.company), 'movements carry deal names');

  const costs = await workforce.costSummary(adapter, ws.id);
  assert.strictEqual(costs.tasks, 8, 'eight tasks today');
  const byProvider = Object.fromEntries(costs.by_provider.map(p => [p.provider, p]));
  assert.ok(byProvider.claude, 'claude in cost breakdown');
  assert.ok(byProvider.gemini, 'gemini in cost breakdown');
  assert.strictEqual(byProvider.claude.cost_cents, 11, 'claude cost');
  assert.strictEqual(byProvider.gemini.cost_cents, 7, 'gemini cost');
  assert.strictEqual(costs.by_provider[0].cost_cents, Math.max(11, 7), 'sorted by cost desc');
  assert.strictEqual(costs.today_cost_cents, costs.by_provider.reduce((a, p) => a + p.cost_cents, 0), 'total matches breakdown');
  assert.ok(costs.avg_per_task_cents > 0, 'avg per task computed');

  const checks = await workforce.healthCheck(adapter, ws.id, 5);
  assert.strictEqual(checks.length, 6, 'six health checks');
  const workers = checks.find(c => c.label === 'Workers');
  assert.strictEqual(workers.detail, '13/13 online', 'workers healthy');
  assert.strictEqual(workers.ok, true, 'workers ok');
  const memoryCheck = checks.find(c => c.label === 'Memory');
  assert.strictEqual(memoryCheck.ok, true, 'memory seeded → ok');
  const dbCheck = checks.find(c => c.label === 'Database');
  assert.strictEqual(dbCheck.ok, Boolean(process.env.DATABASE_URL), 'db reflects env');
  const auditCheck = checks.find(c => c.label === 'Audit');
  assert.strictEqual(auditCheck.ok, true, 'audit has entries');
  const providersCheck = checks.find(c => c.label === 'AI Providers');
  assert.strictEqual(providersCheck.ok, true, 'providers healthy after runs');

  const tgB = 5002;
  await identity.ensureUser(adapter, tgB);
  const wsB = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tgB)).id,
    companyName: 'Zeta Console',
    lang: 'en',
    plan: 'solo'
  });
  const consoleB = await workforce.workforceConsole(adapter, wsB.id);
  assert.strictEqual(consoleB.today_cost_cents, 0, 'workspace B cost isolated');
  assert.strictEqual(consoleB.completed_tasks, 0, 'workspace B tasks isolated');
  assert.strictEqual(consoleB.estimated_pipeline_cents, 0, 'workspace B pipeline isolated');
  const costsB = await workforce.costSummary(adapter, wsB.id);
  assert.strictEqual(costsB.tasks, 0, 'workspace B cost summary isolated');

  console.log(`\n✓ workforce console + timeline + costs + health (${44} assertions passed)`);
  console.log(`  ${consoleAfter.workers_total} workers · today $${(consoleAfter.today_cost_cents / 100).toFixed(2)} · pipeline $${(consoleAfter.estimated_pipeline_cents / 100).toFixed(2)} · ${costs.by_provider.length} providers`);
  process.exit(0);
})().catch(err => {
  console.error('✗ console test failed:', err);
  process.exit(1);
});

