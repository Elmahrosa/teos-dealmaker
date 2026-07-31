const { createRepos } = require('../db/repos');
const { REGISTRY } = require('./workforce');

function dayOf(iso) {
  return String(iso || '').slice(0, 10);
}

async function costIntelligence(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const [runs, usage, deals] = await Promise.all([
    repos.agentRuns.list(workspaceId),
    repos.usage.list(workspaceId),
    repos.deals.list(workspaceId, {})
  ]);
  const today = dayOf(new Date().toISOString());
  const todayRuns = runs.filter(r => dayOf(r.started_at) === today);
  const todayCost = todayRuns.reduce((acc, r) => acc + (r.cost_cents || 0), 0);

  const todayUsage = usage.filter(u => dayOf(u.created_at) === today);
  const usageTokens = todayUsage.reduce((acc, u) => acc + (u.input_tokens || 0) + (u.output_tokens || 0), 0);
  const estimatedTokens = todayRuns.reduce((acc, r) => acc + Math.max(0, Math.ceil((r.output || '').length / 4)), 0);
  const todayTokens = usageTokens || estimatedTokens;

  const avgCost = todayRuns.length ? todayCost / todayRuns.length : 0;
  const avgRuntimeMs = todayRuns.length ? todayRuns.reduce((acc, r) => acc + (r.duration_ms || 0), 0) / todayRuns.length : 0;

  const byProvider = {};
  const byAgent = {};
  for (const r of todayRuns) {
    const p = r.provider || 'unknown';
    byProvider[p] = byProvider[p] || { cost_cents: 0, tasks: 0, tokens: 0 };
    byProvider[p].cost_cents += r.cost_cents || 0;
    byProvider[p].tasks += 1;
    const a = r.agent_name;
    byAgent[a] = byAgent[a] || { cost_cents: 0, tasks: 0, label: (REGISTRY[a] || {}).label || a };
    byAgent[a].cost_cents += r.cost_cents || 0;
    byAgent[a].tasks += 1;
  }
  for (const u of todayUsage) {
    const p = u.provider || 'unknown';
    byProvider[p] = byProvider[p] || { cost_cents: 0, tasks: 0, tokens: 0 };
    byProvider[p].tokens += (u.input_tokens || 0) + (u.output_tokens || 0);
  }

  const dealNames = {};
  for (const d of deals) dealNames[d.id] = d.company_name;
  const byDeal = {};
  for (const r of todayRuns) {
    if (!r.deal_id) continue;
    byDeal[r.deal_id] = byDeal[r.deal_id] || { deal_id: r.deal_id, cost_cents: 0, tasks: 0 };
    byDeal[r.deal_id].cost_cents += r.cost_cents || 0;
    byDeal[r.deal_id].tasks += 1;
  }

  const days = new Set(runs.map(r => dayOf(r.started_at)).filter(Boolean));
  const allTimeCost = runs.reduce((acc, r) => acc + (r.cost_cents || 0), 0);
  const avgDailyCost = days.size ? allTimeCost / days.size : 0;
  const estMonthly = Math.round(avgDailyCost * 30);

  return {
    today_cost_cents: todayCost,
    today_tokens: todayTokens,
    avg_cost_cents: avgCost,
    avg_runtime_ms: avgRuntimeMs,
    tasks_today: todayRuns.length,
    by_provider: Object.keys(byProvider).map(p => ({ provider: p, ...byProvider[p] })).sort((a, b) => b.cost_cents - a.cost_cents),
    by_agent: Object.keys(byAgent).map(a => ({ agent: a, ...byAgent[a] })).sort((a, b) => b.cost_cents - a.cost_cents),
    by_deal: Object.keys(byDeal).map(id => ({ deal_id: Number(id), company: dealNames[Number(id)] || 'Deal #' + id, ...byDeal[id] })).sort((a, b) => b.cost_cents - a.cost_cents),
    estimated_monthly_cents: estMonthly,
    days_active: days.size
  };
}

module.exports = { costIntelligence };
