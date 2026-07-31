const { createRepos } = require('../db/repos');
const providers = require('./providers');
const queue = require('./queue');

const REGISTRY = {
  orchestrator: { label: 'Orchestrator', role: 'Routes every request through the right agent', cadence: 5, queue: 'incoming' },
  prospecting: { label: 'Prospector', role: 'Finds and scores new companies', cadence: 60, queue: 'research' },
  market_intelligence: { label: 'Researcher', role: 'Analyzes companies and prospect fit', cadence: 60, queue: 'research' },
  qualification: { label: 'Qualifier', role: 'Classifies leads by BANT', cadence: 10, queue: 'qualification' },
  outreach: { label: 'Outreach', role: 'Drafts and dispatches emails', cadence: 30, queue: 'proposal' },
  strategist: { label: 'Strategist', role: 'Builds tactical deal playbooks', cadence: 15, queue: 'proposal' },
  marketer: { label: 'Marketer', role: 'Positions value for every deal', cadence: 15, queue: 'proposal' },
  sales: { label: 'Sales', role: 'Handles objections', cadence: 5, queue: 'negotiation' },
  negotiator: { label: 'Negotiator', role: 'Sets thresholds and terms', cadence: 15, queue: 'negotiation' },
  treasurer: { label: 'Treasurer', role: 'Drafts contracts and checkout', cadence: 15, queue: 'closing' },
  gatekeeper: { label: 'Gatekeeper', role: 'Reviews drafts for safety', cadence: 5, queue: 'qualification' },
  closing: { label: 'Closer', role: 'Closes or blocks deals', cadence: 15, queue: 'closing' }
};

function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60000).toISOString();
}

function latestOf(runs) {
  return runs.reduce((a, b) => {
    if (!a) return b;
    return (b.id || 0) > (a.id || 0) ? b : a;
  }, null);
}

function shortTime(iso) {
  if (!iso) return '—';
  return String(iso).slice(11, 16) + ' UTC';
}

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

async function ensureAgent(adapter, workspaceId, agentType) {
  const repos = createRepos(adapter);
  let agent = await repos.agents.getByWorkspace(workspaceId, agentType);
  if (!agent) {
    agent = await repos.agents.create({ workspace_id: workspaceId, agent_type: agentType, status: 'ready' });
  }
  return agent;
}

async function runAgent(adapter, workspaceId, agentType, fn, opts) {
  const o = opts || {};
  const repos = createRepos(adapter);
  const agent = await ensureAgent(adapter, workspaceId, agentType);
  const meta = REGISTRY[agentType] || { label: agentType, cadence: 15 };

  await repos.agents.update(workspaceId, agentType, { status: 'running' });
  const run = await repos.agentRuns.start({
    workspace_id: workspaceId,
    deal_id: o.deal_id || null,
    agent_name: agentType,
    provider: o.provider || agent.provider || null,
    model: o.model || agent.model || null,
    input: o.input !== undefined ? o.input : (o.prompt !== undefined ? o.prompt : null)
  });

  const started = Date.now();
  let result;
  let status = 'completed';
  let error = null;
  let llm = null;
  try {
    if (o.prompt !== undefined && o.prompt !== null) {
      llm = await providers.generate(adapter, workspaceId, agentType, o.prompt, {
        provider: o.provider,
        model: o.model,
        temperature: o.temperature
      });
      result = { output: llm.text, cost_cents: llm.cost_cents, provider: llm.provider, model: llm.model };
    } else {
      result = await fn();
    }
  } catch (err) {
    status = 'error';
    error = err;
    result = { output: 'ERROR: ' + err.message, cost_cents: 0 };
  }
  const durationMs = Date.now() - started;
  const costCents = result && result.cost_cents ? result.cost_cents : 0;
  const runProvider = result && result.provider ? result.provider : (o.provider || agent.provider || null);
  const runModel = result && result.model ? result.model : (o.model || agent.model || null);

  await repos.agentRuns.complete(workspaceId, run.id, {
    status,
    output: result ? result.output : null,
    duration_ms: durationMs,
    cost_cents: costCents,
    provider: runProvider,
    model: runModel
  });

  const next = minutesFromNow(meta.cadence);
  await repos.agents.update(workspaceId, agentType, {
    status: 'ready',
    provider: o.provider || runProvider || agent.provider || null,
    model: o.model || runModel || agent.model || null,
    last_run_at: new Date().toISOString(),
    next_run_at: next,
    total_runs: (agent.total_runs || 0) + 1,
    total_cost_cents: (agent.total_cost_cents || 0) + costCents
  });

  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: agentType,
    action_type: 'AGENT_RUN_' + (status === 'completed' ? 'SUCCESS' : 'ERROR'),
    details: { agent: meta.label, duration_ms: durationMs, cost_cents: costCents, provider: runProvider, model: runModel, deal_id: o.deal_id || null },
    version: 'v0.5.0'
  });

  if (error) throw error;
  return { runId: run.id, agentType, label: meta.label, status, result, duration_ms: durationMs, cost_cents: costCents };
}

async function runPipelineDemo(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const memorySvc = require('./memory');
  const { buildPlaybook } = require('../agents/strategist');
  const { craftPositioning } = require('../agents/marketer');
  const { buildTerms } = require('../agents/negotiator');
  const { draftContract, createCheckout, closeDeal } = require('../agents/treasurer');
  const { closeDeal: closingAgent } = require('../agents/closing');

  const mem = await memorySvc.getMemory(adapter, workspaceId);

  const lead = {
    id: 'deal_ws_' + Date.now(),
    company: mem.company_name || 'Control Center Demo',
    contactName: 'Enterprise Operator',
    product: mem.products && mem.products.length ? mem.products[0] : 'TEOS DealMaker Sovereign License',
    classification: 'Hot',
    fitScore: 92,
    budget: 15000,
    competitivePressure: 'low',
    industry: mem.industry || 'Technology',
    currency: 'USD',
    termMonths: 12,
    paymentMethod: 'invoice'
  };
  const targetPrice = 12500;

  const d = await queue.enqueueDeal(adapter, workspaceId, lead.company);
  await queue.advanceQueue(adapter, workspaceId, d.id, 'research');
  await queue.advanceQueue(adapter, workspaceId, d.id, 'qualification');

  const collaborate = (agentType, note) =>
    repos.dealNotes.add({ workspace_id: workspaceId, deal_id: d.id, agent_name: agentType, note });

  const strategy = await runAgent(adapter, workspaceId, 'strategist', async () => {
    const ctx = await memorySvc.getContextFor(adapter, workspaceId, 'strategist');
    const r = buildPlaybook(lead);
    const note = `Playbook: ${r.style}${ctx.competitors && ctx.competitors.length ? ' · beat ' + ctx.competitors.slice(0, 2).join(', ') : ''}`;
    await collaborate('strategist', note);
    return { output: note, cost_cents: 1, data: r };
  }, { deal_id: d.id });
  const marketing = await runAgent(adapter, workspaceId, 'marketer', async () => {
    const r = craftPositioning(lead, strategy.result.data);
    const note = `Positioning: ${r.headline}`;
    await collaborate('marketer', note);
    return { output: note, cost_cents: 1, data: r };
  }, { deal_id: d.id });
  await queue.advanceQueue(adapter, workspaceId, d.id, 'proposal');
  const negotiation = await runAgent(adapter, workspaceId, 'negotiator', async () => {
    const r = buildTerms(lead, targetPrice, lead.budget);
    const note = `Landing $${r.landingPrice} (max discount ${r.maxDiscount}%)`;
    await collaborate('negotiator', note);
    return { output: note, cost_cents: 1, data: r };
  }, { deal_id: d.id });
  await queue.advanceQueue(adapter, workspaceId, d.id, 'negotiation');
  const deal = { ...lead, amount: negotiation.result.data.landingPrice };
  await repos.deals.update(workspaceId, d.id, { deal_value: deal.amount, current_agent: 'treasurer' });
  const treasurer = await runAgent(adapter, workspaceId, 'treasurer', async () => {
    const contract = draftContract(deal);
    const checkout = await createCheckout(deal, contract);
    closeDeal(deal, contract, checkout);
    const note = `Contract ${contract.contractId}${checkout ? ' · ' + checkout.url : ''}`;
    await collaborate('treasurer', note);
    return { output: note, cost_cents: 2, data: { contract, checkout } };
  }, { deal_id: d.id });
  await queue.advanceQueue(adapter, workspaceId, d.id, 'closing');
  const closing = await runAgent(adapter, workspaceId, 'closing', async () => {
    const r = closingAgent({
      id: lead.id,
      company: lead.company,
      amount: deal.amount,
      currency: 'USD',
      contractId: treasurer.result.data.contract.contractId,
      approved: true,
      paymentMethod: 'invoice'
    });
    const note = `Outcome: ${r.status}`;
    await collaborate('closing', note);
    return { output: note, cost_cents: 0, data: r };
  }, { deal_id: d.id });
  const won = closing.result.data.status === 'won';
  if (won) await queue.advanceQueue(adapter, workspaceId, d.id, 'won');

  const notes = await repos.dealNotes.list(workspaceId, d.id);
  const finalDeal = await repos.deals.get(workspaceId, d.id);

  return {
    strategy: strategy.result.data,
    marketing: marketing.result.data,
    negotiation: negotiation.result.data,
    treasurer: treasurer.result.data,
    closing: closing.result.data,
    deal: finalDeal || d,
    notes,
    won,
    runs: [strategy, marketing, negotiation, treasurer, closing]
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

async function dealTimeline(adapter, workspaceId, dealId) {
  const repos = createRepos(adapter);
  const [deal, notes, events] = await Promise.all([
    repos.deals.get(workspaceId, dealId),
    repos.dealNotes.list(workspaceId, dealId),
    repos.pipeline.list(workspaceId, dealId)
  ]);
  if (!deal) return null;
  const noteRows = notes.map(n => ({
    time: n.created_at || null,
    agent_name: n.agent_name,
    kind: 'note',
    text: n.note
  }));
  const eventRows = events.map(e => ({
    time: e.created_at || null,
    agent_name: 'Pipeline',
    kind: 'stage',
    text: `${e.from_stage || '—'} → ${e.to_stage}`
  }));
  return { deal, notes: noteRows, events: eventRows };
}

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

module.exports = { REGISTRY, getWorkforceView, runAgent, runPipelineDemo, todayActivity, shortTime, workforceConsole, dealTimeline, costSummary, healthCheck, agentHealth };
