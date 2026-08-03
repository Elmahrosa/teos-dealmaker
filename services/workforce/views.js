const { createRepos } = require('../../db/repos');
const { REGISTRY } = require('./registry');
const { latestOf } = require('./format');

async function getWorkforceView(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const [agents, runs] = await Promise.all([
    repos.agents.list(workspaceId),
    repos.agentRuns.list(workspaceId)
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return {
    agents: agents.map(a => {
      const meta = REGISTRY[a.agent_type] || { label: a.agent_type, role: '', cadence: 15 };
      const runsFor = runs.filter(r => r.agent_name === a.agent_type);
      const todayRuns = runsFor.filter(r => (r.started_at || '').startsWith(today)).length;
      return {
        agent_type: a.agent_type,
        label: meta.label,
        role: meta.role,
        status: a.status,
        provider: a.provider,
        model: a.model,
        total_runs: a.total_runs || 0,
        total_cost_cents: a.total_cost_cents || 0,
        last_run_at: a.last_run_at,
        next_run_at: a.next_run_at,
        today_runs: todayRuns,
        last_output: latestOf(runsFor) ? latestOf(runsFor).output : null
      };
    }),
    today_runs_total: runs.filter(r => (r.started_at || '').startsWith(today)).length
  };
}

async function workforceConsole(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const [agents, runs, deals] = await Promise.all([
    repos.agents.list(workspaceId),
    repos.agentRuns.list(workspaceId),
    repos.deals.list(workspaceId, {})
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const todayRuns = runs.filter(r => (r.started_at || '').startsWith(today));
  const openDeals = deals.filter(d => d.status === 'open');
  const busy = agents.filter(a => a.status === 'running' || a.status === 'waiting').length;
  const ready = agents.filter(a => a.status === 'ready' || a.status === 'paused').length;
  const rows = agents.map(a => {
    const meta = REGISTRY[a.agent_type] || { label: a.agent_type, role: '', cadence: 15 };
    const ranToday = todayRuns.filter(r => r.agent_name === a.agent_type);
    let display;
    let tone;
    if (a.status === 'running') { display = 'Running'; tone = 'info'; }
    else if (ranToday.length > 0) { display = 'Completed'; tone = 'success'; }
    else if (a.next_run_at && a.next_run_at > new Date().toISOString()) { display = 'Waiting'; tone = 'warning'; }
    else { display = 'Ready'; tone = 'success'; }
    return {
      agent_type: a.agent_type,
      label: meta.label,
      role: meta.role,
      status: a.status,
      display,
      tone,
      today_runs: ranToday.length,
      total_runs: a.total_runs || 0,
      cost_cents: a.total_cost_cents || 0,
      last_output: ranToday[0] ? ranToday[0].output : null,
      next_run_at: a.next_run_at
    };
  });
  return {
    agents: rows,
    workers_total: agents.length,
    busy,
    ready,
    today_runs: todayRuns.length,
    today_cost_cents: todayRuns.reduce((acc, r) => acc + (r.cost_cents || 0), 0),
    completed_tasks: agents.reduce((acc, a) => acc + (a.total_runs || 0), 0),
    estimated_pipeline_cents: openDeals.reduce((acc, d) => acc + (d.deal_value || 0), 0),
    open_deals: openDeals.length
  };
}

async function todayActivity(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const runs = await repos.agentRuns.list(workspaceId);
  const today = new Date().toISOString().slice(0, 10);
  const todaysRuns = runs.filter(r => (r.started_at || '').startsWith(today));
  return Object.keys(REGISTRY).map(agentType => {
    const meta = REGISTRY[agentType];
    const own = todaysRuns.filter(r => r.agent_name === agentType);
    const latest = latestOf(own);
    return {
      agent_type: agentType,
      label: meta.label,
      role: meta.role,
      runs: own.length,
      status: latest ? latest.status : 'idle',
      last_output: latest ? latest.output : null
    };
  });
}

module.exports = { getWorkforceView, workforceConsole, todayActivity };
