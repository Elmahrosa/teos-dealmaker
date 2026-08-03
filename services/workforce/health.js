const { createRepos } = require('../../db/repos');
const { REGISTRY } = require('./registry');
const { latestOf } = require('./format');

async function agentHealth(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const [agents, runs] = await Promise.all([
    repos.agents.list(workspaceId),
    repos.agentRuns.list(workspaceId)
  ]);
  return agents.map(a => {
    const meta = REGISTRY[a.agent_type] || { label: a.agent_type, role: '', cadence: 15, queue: 'incoming' };
    const own = runs.filter(r => r.agent_name === a.agent_type);
    const completed = own.filter(r => r.status === 'completed');
    const failed = own.filter(r => r.status === 'error');
    const last = latestOf(own);
    const lastSuccess = latestOf(completed);
    const lastError = latestOf(failed);
    const avgRuntimeMs = own.length ? own.reduce((acc, r) => acc + (r.duration_ms || 0), 0) / own.length : 0;
    const successPct = own.length ? Math.round((completed.length / own.length) * 100) : null;
    let display;
    let tone;
    if (a.status === 'paused') { display = 'Disabled'; tone = 'critical'; }
    else if (last && last.status === 'error') { display = 'Failed'; tone = 'critical'; }
    else if (a.status === 'running' || a.status === 'waiting') { display = 'Busy'; tone = 'warning'; }
    else { display = 'Ready'; tone = 'success'; }
    return {
      agent_type: a.agent_type,
      label: meta.label,
      queue: meta.queue,
      display,
      tone,
      last_run_at: last ? last.started_at : null,
      last_success_at: lastSuccess ? lastSuccess.started_at : null,
      last_error: lastError ? (lastError.output || lastError.status) : null,
      last_error_at: lastError ? lastError.started_at : null,
      avg_runtime_ms: avgRuntimeMs,
      success_pct: successPct,
      total_runs: own.length
    };
  });
}

async function healthCheck(adapter, workspaceId, vaultEntries) {
  const repos = createRepos(adapter);
  const [agents, mem, runs] = await Promise.all([
    repos.agents.list(workspaceId),
    repos.memory.list(workspaceId),
    repos.agentRuns.list(workspaceId)
  ]);
  const online = agents.filter(a => a.status === 'ready' || a.status === 'running' || a.status === 'waiting').length;
  const configuredProviders = [...new Set(agents.map(a => a.provider).filter(Boolean))];
  return [
    { label: 'AI Providers', ok: configuredProviders.length > 0 || runs.length > 0, detail: configuredProviders.length ? configuredProviders.join(', ') : 'runtime active — no provider keys yet' },
    { label: 'Database', ok: Boolean(process.env.DATABASE_URL), detail: process.env.DATABASE_URL ? 'Postgres connected' : 'in-memory (no DATABASE_URL)' },
    { label: 'Payments', ok: Boolean(process.env.DODO_API_KEY), detail: process.env.DODO_API_KEY ? 'Dodo connected' : 'dry-run mode' },
    { label: 'Audit', ok: (vaultEntries || 0) > 0, detail: `${vaultEntries || 0} entries` },
    { label: 'Memory', ok: mem.length > 0, detail: `${mem.length} keys` },
    { label: 'Workers', ok: online === agents.length, detail: `${online}/${agents.length} online` }
  ];
}

module.exports = { agentHealth, healthCheck };
