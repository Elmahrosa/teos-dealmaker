const { createRepos } = require('../db/repos');

const REGISTRY = {
  orchestrator: { label: 'Orchestrator', role: 'Routes every request through the right agent', cadence: 5 },
  prospecting: { label: 'Prospector', role: 'Finds and scores new companies', cadence: 60 },
  market_intelligence: { label: 'Researcher', role: 'Analyzes companies and prospect fit', cadence: 60 },
  qualification: { label: 'Qualifier', role: 'Classifies leads by BANT', cadence: 10 },
  outreach: { label: 'Outreach', role: 'Drafts and dispatches emails', cadence: 30 },
  strategist: { label: 'Strategist', role: 'Builds tactical deal playbooks', cadence: 15 },
  marketer: { label: 'Marketer', role: 'Positions value for every deal', cadence: 15 },
  sales: { label: 'Sales', role: 'Handles objections', cadence: 5 },
  negotiator: { label: 'Negotiator', role: 'Sets thresholds and terms', cadence: 15 },
  treasurer: { label: 'Treasurer', role: 'Drafts contracts and checkout', cadence: 15 },
  gatekeeper: { label: 'Gatekeeper', role: 'Reviews drafts for safety', cadence: 5 },
  closing: { label: 'Closer', role: 'Closes or blocks deals', cadence: 15 }
};

function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60000).toISOString();
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
        last_output: runsFor.length ? runsFor[0].output : null
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
    agent_name: agentType,
    provider: o.provider || agent.provider || null,
    model: o.model || agent.model || null,
    input: o.input !== undefined ? o.input : null
  });

  const started = Date.now();
  let result;
  let status = 'completed';
  let error = null;
  try {
    result = await fn();
  } catch (err) {
    status = 'error';
    error = err;
    result = { output: 'ERROR: ' + err.message, cost_cents: 0 };
  }
  const durationMs = Date.now() - started;
  const costCents = result && result.cost_cents ? result.cost_cents : 0;

  await repos.agentRuns.complete(workspaceId, run.id, {
    status,
    output: result ? result.output : null,
    duration_ms: durationMs,
    cost_cents: costCents
  });

  const next = minutesFromNow(meta.cadence);
  await repos.agents.update(workspaceId, agentType, {
    status: 'ready',
    provider: o.provider || agent.provider || null,
    model: o.model || agent.model || null,
    last_run_at: new Date().toISOString(),
    next_run_at: next,
    total_runs: (agent.total_runs || 0) + 1,
    total_cost_cents: (agent.total_cost_cents || 0) + costCents
  });

  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: agentType,
    action_type: 'AGENT_RUN_' + (status === 'completed' ? 'SUCCESS' : 'ERROR'),
    details: { agent: meta.label, duration_ms: durationMs, cost_cents: costCents, input: o.input },
    version: 'v0.3.1'
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

  const d = await repos.deals.create({
    workspace_id: workspaceId,
    company_name: lead.company,
    stage: 'lead',
    status: 'open',
    deal_value: null,
    currency: 'USD',
    current_agent: 'strategist'
  });

  const collaborate = (agentType, note) =>
    repos.dealNotes.add({ workspace_id: workspaceId, deal_id: d.id, agent_name: agentType, note });

  const strategy = await runAgent(adapter, workspaceId, 'strategist', async () => {
    const ctx = await memorySvc.getContextFor(adapter, workspaceId, 'strategist');
    const r = buildPlaybook(lead);
    const note = `Playbook: ${r.style}${ctx.competitors && ctx.competitors.length ? ' · beat ' + ctx.competitors.slice(0, 2).join(', ') : ''}`;
    await collaborate('strategist', note);
    return { output: note, cost_cents: 1, data: r };
  });
  const marketing = await runAgent(adapter, workspaceId, 'marketer', async () => {
    const r = craftPositioning(lead, strategy.result.data);
    const note = `Positioning: ${r.headline}`;
    await collaborate('marketer', note);
    return { output: note, cost_cents: 1, data: r };
  });
  const negotiation = await runAgent(adapter, workspaceId, 'negotiator', async () => {
    const r = buildTerms(lead, targetPrice, lead.budget);
    const note = `Landing $${r.landingPrice} (max discount ${r.maxDiscount}%)`;
    await collaborate('negotiator', note);
    return { output: note, cost_cents: 1, data: r };
  });
  const deal = { ...lead, amount: negotiation.result.data.landingPrice };
  await repos.deals.update(workspaceId, d.id, { deal_value: deal.amount, current_agent: 'treasurer' });
  const treasurer = await runAgent(adapter, workspaceId, 'treasurer', async () => {
    const contract = draftContract(deal);
    const checkout = await createCheckout(deal, contract);
    closeDeal(deal, contract, checkout);
    const note = `Contract ${contract.contractId}${checkout ? ' · ' + checkout.url : ''}`;
    await collaborate('treasurer', note);
    return { output: note, cost_cents: 2, data: { contract, checkout } };
  });
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
  });

  await repos.deals.advanceStage(workspaceId, d.id, 'closing', 'lead');

  const notes = await repos.dealNotes.list(workspaceId, d.id);

  return {
    strategy: strategy.result.data,
    marketing: marketing.result.data,
    negotiation: negotiation.result.data,
    treasurer: treasurer.result.data,
    closing: closing.result.data,
    deal: d,
    notes,
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
    const latest = own[0] || null;
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

module.exports = { REGISTRY, getWorkforceView, runAgent, runPipelineDemo, todayActivity, shortTime };
