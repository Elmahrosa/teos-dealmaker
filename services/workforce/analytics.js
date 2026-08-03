const { createRepos } = require('../../db/repos');

async function costSummary(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const runs = await repos.agentRuns.list(workspaceId);
  const today = new Date().toISOString().slice(0, 10);
  const todayRuns = runs.filter(r => (r.started_at || '').startsWith(today));
  const byProvider = {};
  for (const r of todayRuns) {
    const p = r.provider || 'unknown';
    byProvider[p] = byProvider[p] || { cost_cents: 0, tasks: 0 };
    byProvider[p].cost_cents += r.cost_cents || 0;
    byProvider[p].tasks += 1;
  }
  const total = todayRuns.reduce((acc, r) => acc + (r.cost_cents || 0), 0);
  return {
    today_cost_cents: total,
    tasks: todayRuns.length,
    avg_per_task_cents: todayRuns.length ? total / todayRuns.length : 0,
    by_provider: Object.keys(byProvider).map(p => ({ provider: p, ...byProvider[p] })).sort((a, b) => b.cost_cents - a.cost_cents)
  };
}

module.exports = { costSummary };
