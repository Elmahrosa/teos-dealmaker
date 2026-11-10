const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');
const workforce = require('../services/workforce');
const PIPELINE_INPUT = { assetType: 'product', description: 'Industrial widget lot', askingPrice: 12000, currency: 'USD', sellerTarget: 10000, buyerBudget: 11000 };
const { setMode } = require('../config/mode');
const { costIntelligence } = require('../services/cost');
const { executiveBriefing } = require('../services/briefing');
const queue = require('../services/queue');

(async () => {
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  const tg = 7001;
  await identity.ensureUser(adapter, tg, { display_name: 'Ops Owner' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tg)).id,
    companyName: 'Ops Co',
    lang: 'en',
    plan: 'growth'
  });

  await workforce.runAgent(adapter, ws.id, 'prospecting', async () => ({
    output: 'Found 38 companies',
    cost_cents: 11,
    provider: 'gemini',
    model: 'gemini-2.0-flash'
  }));
  await workforce.runAgent(adapter, ws.id, 'market_intelligence', async () => ({
    output: 'Researched dossier ready',
    cost_cents: 7,
    provider: 'anthropic',
    model: 'claude-sonnet-4-5'
  }));

  const cost = await costIntelligence(adapter, ws.id);
  assert.strictEqual(cost.today_cost_cents, 18, 'today cost sums runs');
  assert.strictEqual(cost.tasks_today, 2, 'two tasks today');
  assert.strictEqual(cost.avg_cost_cents, 9, 'average cost per task');
  assert.ok(typeof cost.avg_runtime_ms === 'number', 'average runtime computed');
  assert.ok(cost.today_tokens > 0, 'tokens estimated from output');
  assert.strictEqual(cost.by_provider.length, 2, 'cost by provider');
  const geminiCost = cost.by_provider.find(p => p.provider === 'gemini');
  assert.strictEqual(geminiCost.cost_cents, 11, 'gemini cost');
  const agentCost = cost.by_agent.find(a => a.agent === 'prospecting');
  assert.strictEqual(agentCost.label, 'Prospector', 'cost by agent with label');
  assert.strictEqual(cost.estimated_monthly_cents, 540, 'estimated monthly = 18 × 30');
  assert.strictEqual(cost.by_deal.length, 0, 'no deals yet');

  const pipeline = (setMode('LIVE'), await workforce.runPipeline(adapter, ws.id, PIPELINE_INPUT));
  const costAfter = await costIntelligence(adapter, ws.id);
  assert.strictEqual(costAfter.tasks_today, 8, 'eight tasks after pipeline');
  const dealCost = costAfter.by_deal.find(d => d.deal_id === pipeline.deal.id);
  assert.ok(dealCost, 'cost per deal present');
  assert.ok(dealCost.cost_cents > 0, 'deal has cost');
  assert.strictEqual(dealCost.company, pipeline.deal.company_name, 'deal cost carries company');

  const health = await workforce.agentHealth(adapter, ws.id);
  assert.strictEqual(health.length, 13, 'health for 13 agents');
  const prospector = health.find(a => a.agent_type === 'prospecting');
  assert.strictEqual(prospector.display, 'Ready', 'healthy agent ready');
  assert.strictEqual(prospector.success_pct, 100, '100% success');
  assert.ok(typeof prospector.avg_runtime_ms === 'number', 'avg runtime tracked');
  assert.strictEqual(prospector.queue, 'research', 'queue assignment');
  assert.ok(prospector.last_run_at, 'last run tracked');
  assert.ok(prospector.last_success_at, 'last success tracked');
  assert.strictEqual(prospector.last_error, null, 'no error');

  let threw = false;
  try {
    await workforce.runAgent(adapter, ws.id, 'outreach', async () => {
      throw new Error('SMTP down');
    });
  } catch (_) {
    threw = true;
  }
  assert.strictEqual(threw, true, 'runAgent surfaces agent errors');
  const outreachHealth = (await workforce.agentHealth(adapter, ws.id)).find(a => a.agent_type === 'outreach');
  assert.strictEqual(outreachHealth.display, 'Failed', 'failed agent shows failed');
  assert.strictEqual(outreachHealth.success_pct, 0, '0% success after failure');
  assert.ok(outreachHealth.last_error_at, 'last error tracked');

  await repos.agents.updateStatus(ws.id, 'orchestrator', 'paused');
  const orchestratorHealth = (await workforce.agentHealth(adapter, ws.id)).find(a => a.agent_type === 'orchestrator');
  assert.strictEqual(orchestratorHealth.display, 'Disabled', 'paused agent disabled');

  const briefing = await executiveBriefing(adapter, ws.id);
  assert.strictEqual(briefing.yesterday.prospects, 0, 'no runs yesterday');
  assert.ok(briefing.today_opportunities >= 2, 'today opportunities from prospecting+research');
  assert.strictEqual(briefing.pipeline_value_cents, 12000, 'deal stays in open pipeline until customer accepts and pays');
  assert.strictEqual(briefing.meetings_needed, 0, 'no meetings needed');
  assert.strictEqual(briefing.revenue_forecast_cents, 2400, 'forecast = 20% of open pipeline');
  assert.ok(Array.isArray(briefing.high_risk_deals), 'high risk array');
  assert.ok(briefing.recommended_action.length > 0, 'recommended action present');

  await queue.enqueueDeal(adapter, ws.id, 'Fresh Lead Ltd');
  const briefingWithDeal = await executiveBriefing(adapter, ws.id);
  assert.strictEqual(briefingWithDeal.meetings_needed, 0, 'incoming deal not yet meeting-eligible');
  assert.strictEqual(briefingWithDeal.pipeline_value_cents, 12000, 'fresh lead adds no value to the open pipeline');
  assert.strictEqual(briefingWithDeal.open_deals, 2, 'fresh lead and pipeline deal are open');
  const freshDeal = (await queue.queueSnapshot(adapter, ws.id)).stages.find(s => s.stage === 'incoming');
  assert.strictEqual(freshDeal.count, 1, 'incoming stage has the fresh lead');
  await queue.advanceQueue(adapter, ws.id, (await repos.deals.list(ws.id, {})).find(d => d.company_name === 'Fresh Lead Ltd').id, 'research');
  const briefingResearch = await executiveBriefing(adapter, ws.id);
  assert.strictEqual(briefingResearch.meetings_needed, 1, 'research deal needs a meeting');

  const tgB = 7002;
  await identity.ensureUser(adapter, tgB);
  const wsB = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tgB)).id,
    companyName: 'Zeta Ops',
    lang: 'en',
    plan: 'solo'
  });
  const costB = await costIntelligence(adapter, wsB.id);
  assert.strictEqual(costB.today_cost_cents, 0, 'cost isolated per workspace');
  const healthB = await workforce.agentHealth(adapter, wsB.id);
  assert.ok(healthB.every(h => h.success_pct === null), 'workspace B agents never ran');

  console.log(`\n✓ cost intelligence + agent health + briefing (${33} assertions passed)`);
  console.log(`  today $${(costAfter.today_cost_cents / 100).toFixed(2)} · ${costAfter.by_provider.length} providers · est monthly $${(costAfter.estimated_monthly_cents / 100).toFixed(2)} · ${health.length} agents health-tracked`);
  process.exit(0);
})().catch(err => {
  console.error('✗ operations test failed:', err);
  process.exit(1);
});

