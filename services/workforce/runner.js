const { createRepos } = require('../../db/repos');
const providers = require('../providers');
const { REGISTRY } = require('./registry');
const { minutesFromNow } = require('./format');

async function intelligencePrompt(adapter, workspaceId, agentType, prompt) {
  const intelligence = require('../intelligence');
  const integrations = require('../integrations');
  const hits = await intelligence.retrieve(adapter, workspaceId, prompt, { topK: 3 });
  let enriched = prompt;
  if (hits.length) {
    const block = hits.map((h, i) => `[${i + 1}] ${h.title} — ${h.text}`).join('\n');
    enriched = `${prompt}\n\nCompany knowledge from the Enterprise Intelligence layer:\n${block}`;
  }
  try {
    const st = await integrations.manager.status(adapter, workspaceId);
    const enabled = st.categories.flatMap(c => c.connectors.filter(x => x.enabled));
    if (enabled.length) {
      const names = enabled.map(x => x.label).join(', ');
      enriched = `${enriched}\n\nConnected systems via the Integration Hub: ${names}. You may use integration.searchContacts, integration.searchDeals, integration.sendMessage, integration.createMeeting, integration.storeDocument, integration.fetchKnowledge or integration.crawl to work with them.`;
    }
  } catch (_) { /* integrations are optional context */ }
  return enriched;
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
    plan_id: o.plan_id || null,
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
      const enriched = await intelligencePrompt(adapter, workspaceId, agentType, o.prompt);
      llm = await providers.generate(adapter, workspaceId, agentType, enriched, {
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
    version: 'v0.6.0'
  });

  if (error) throw error;
  return { runId: run.id, agentType, label: meta.label, status, result, duration_ms: durationMs, cost_cents: costCents };
}

module.exports = { runAgent, ensureAgent, intelligencePrompt };
