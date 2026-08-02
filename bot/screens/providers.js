const design = require('../design');
const { getStoreAdapter } = require('../store');
const providers = require('../../services/providers');
const workforce = require('../../services/workforce');
const { costIntelligence } = require('../../services/cost');
const { getCtx, titleCase } = require('./lib');

async function buildProviders(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('AI Settings')}`,
        design.it('Set up a workspace to manage providers.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const catalogRows = Object.entries(providers.PROVIDERS).map(([key, p]) => {
    const cfg = providers.isConfigured(key);
    return design.row(p.label, cfg ? `${design.EMOJI.success} ${p.defaultModel}` : `${design.EMOJI.info} no key`);
  });
  const policy = await providers.getPolicy(getStoreAdapter(), ctx.workspace.id);
  const policyRows = Object.entries(policy).map(([agentType, p]) => {
    const label = (workforce.REGISTRY[agentType] || {}).label || agentType;
    return design.row(label, `${titleCase(p.provider)} · ${p.model}`);
  });
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('AI Providers')}`,
    design.it('Routing · policies · costs'),
    design.divider(),
    design.section('PROVIDER CATALOG'),
    ...catalogRows,
    design.section('AGENT POLICIES'),
    ...policyRows,
    design.it('Set an API key to go live. Without keys, runs are simulated at no cost.'),
    design.divider()
  ]);
  const policyKeys = Object.keys(policy);
  const rows = [];
  for (let i = 0; i < policyKeys.length; i += 2) {
    const a = policyKeys[i];
    const b = policyKeys[i + 1];
    rows.push([
      design.textButton((workforce.REGISTRY[a] || {}).label || a, `cc_pol:${a}`),
      b ? design.textButton((workforce.REGISTRY[b] || {}).label || b, `cc_pol:${b}`) : null
    ].filter(Boolean));
  }
  rows.push([design.textButton('Costs', 'cc_costs'), design.textButton('Back to Home', 'cc_home')]);
  return {
    text,
    keyboard: design.keyboard(rows)
  };
}

async function buildProviderPicker(userId, agentType) {
  const ctx = await getCtx(userId);
  const label = (workforce.REGISTRY[agentType] || {}).label || agentType;
  const policy = await providers.getPolicy(getStoreAdapter(), ctx.workspace.id);
  const current = policy[agentType] || { provider: '—', model: '—' };
  const rows = Object.keys(providers.PROVIDERS).map(key => [
    design.textButton(providers.PROVIDERS[key].label, `cc_pol_set:${agentType}:${key}`)
  ]);
  rows.push([design.textButton('Cancel', 'cc_providers')]);
  return {
    text: design.compose([
      `${design.EMOJI.ai} ${design.b('Provider for ' + label)}`,
      design.it(`Current: ${titleCase(current.provider)} · ${current.model}`),
      design.divider(),
      design.it('Choose a provider to route this agent.'),
      design.divider()
    ]),
    keyboard: design.keyboard(rows)
  };
}

async function buildCosts(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('AI Cost Intelligence')}`,
        design.it('Set up a workspace to see costs.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const c = await costIntelligence(getStoreAdapter(), ctx.workspace.id);
  const providerRows = c.by_provider.length
    ? c.by_provider.map(p => design.row(titleCase(p.provider), `$${(p.cost_cents / 100).toFixed(2)} · ${p.tasks} tasks · ${p.tokens} tokens`))
    : [design.it('No provider usage today yet.')];
  const agentRows = c.by_agent.filter(a => a.tasks > 0).slice(0, 5)
    .map(a => design.row(a.label, `$${(a.cost_cents / 100).toFixed(2)} · ${a.tasks} tasks`));
  const dealRows = c.by_deal.slice(0, 3)
    .map(d => design.row(d.company, `$${(d.cost_cents / 100).toFixed(2)} · ${d.tasks} runs`));
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('AI Cost Intelligence')}`,
    design.it('Spend, tokens and averages'),
    design.divider(),
    design.section('TODAY'),
    ...providerRows,
    design.row('Total', `$${(c.today_cost_cents / 100).toFixed(2)}`),
    design.row('Tokens', String(c.today_tokens)),
    design.row('Tasks', String(c.tasks_today)),
    design.row('Avg per task', `$${(c.avg_cost_cents / 100).toFixed(4)}`),
    design.row('Avg runtime', `${c.avg_runtime_ms} ms`),
    design.section('BY AGENT'),
    ...(agentRows.length ? agentRows : [design.it('No agent runs today.')]),
    design.section('BY DEAL'),
    ...(dealRows.length ? dealRows : [design.it('No deal activity today.')]),
    design.section('FORECAST'),
    design.row('Estimated monthly', `$${(c.estimated_monthly_cents / 100).toFixed(2)}`),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('AI Settings', 'cc_providers'), design.textButton('My Revenue Team', 'cc_workforce')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

module.exports = { buildProviders, buildProviderPicker, buildCosts };
