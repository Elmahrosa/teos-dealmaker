const design = require('../design');
const i18n = require('../i18n');
const { getStoreAdapter } = require('../store');
const providers = require('../../services/providers');
const workforce = require('../../services/workforce');
const { costIntelligence } = require('../../services/cost');
const { getCtx, titleCase } = require('./lib');

async function buildProviders(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b(t('pv_title_settings'))}`,
        design.it(t('pv_body_noctx')),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton(t('common_home'), 'cc_home')]
      ])
    };
  }
  const catalogRows = Object.entries(providers.PROVIDERS).map(([key, p]) => {
    const cfg = providers.isConfigured(key);
    return design.row(p.label, cfg ? `${design.EMOJI.success} ${p.defaultModel}` : `${design.EMOJI.info} ${t('pv_val_nokey')}`);
  });
  const policy = await providers.getPolicy(getStoreAdapter(), ctx.workspace.id);
  const policyRows = Object.entries(policy).map(([agentType, p]) => {
    const label = (workforce.REGISTRY[agentType] || {}).label || agentType;
    return design.row(label, `${titleCase(p.provider)} · ${p.model}`);
  });
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('pv_title_providers'))}`,
    design.it(t('pv_body_sub')),
    design.divider(),
    design.section(t('pv_sec_catalog')),
    ...catalogRows,
    design.section(t('pv_sec_policies')),
    ...policyRows,
    design.it(t('pv_body_nokey')),
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
  rows.push([design.textButton(t('pv_btn_costs'), 'cc_costs'), design.textButton(t('common_home'), 'cc_home')]);
  return {
    text,
    keyboard: design.keyboard(rows)
  };
}

async function buildProviderPicker(userId, agentType) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  const label = (workforce.REGISTRY[agentType] || {}).label || agentType;
  const policy = await providers.getPolicy(getStoreAdapter(), ctx.workspace.id);
  const current = policy[agentType] || { provider: '—', model: '—' };
  const rows = Object.keys(providers.PROVIDERS).map(key => [
    design.textButton(providers.PROVIDERS[key].label, `cc_pol_set:${agentType}:${key}`)
  ]);
  rows.push([design.textButton(t('common_cancel'), 'cc_providers')]);
  return {
    text: design.compose([
      `${design.EMOJI.ai} ${design.b(i18n.sprintf(t('pv_title_picker'), label))}`,
      design.it(i18n.sprintf(t('pv_body_current'), titleCase(current.provider), current.model)),
      design.divider(),
      design.it(t('pv_body_choose')),
      design.divider()
    ]),
    keyboard: design.keyboard(rows)
  };
}

async function buildCosts(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b(t('pv_title_costs'))}`,
        design.it(t('pv_costs_noctx')),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton(t('common_home'), 'cc_home')]
      ])
    };
  }
  const c = await costIntelligence(getStoreAdapter(), ctx.workspace.id);
  const providerRows = c.by_provider.length
    ? c.by_provider.map(p => design.row(titleCase(p.provider), i18n.sprintf(t('pv_cost_provider_line'), (p.cost_cents / 100).toFixed(2), p.tasks, p.tokens)))
    : [design.it(t('pv_costs_none_provider'))];
  const agentRows = c.by_agent.filter(a => a.tasks > 0).slice(0, 5)
    .map(a => design.row(a.label, i18n.sprintf(t('pv_cost_agent_line'), (a.cost_cents / 100).toFixed(2), a.tasks)));
  const dealRows = c.by_deal.slice(0, 3)
    .map(d => design.row(d.company, i18n.sprintf(t('pv_cost_deal_line'), (d.cost_cents / 100).toFixed(2), d.tasks)));
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('pv_title_costs'))}`,
    design.it(t('pv_costs_sub')),
    design.divider(),
    design.section(t('pv_sec_today')),
    ...providerRows,
    design.row(t('pv_row_total'), `$${(c.today_cost_cents / 100).toFixed(2)}`),
    design.row(t('pv_row_tokens'), String(c.today_tokens)),
    design.row(t('pv_row_tasks'), String(c.tasks_today)),
    design.row(t('pv_row_avg_task'), `$${(c.avg_cost_cents / 100).toFixed(4)}`),
    design.row(t('pv_row_avg_runtime'), i18n.sprintf(t('pv_val_ms'), c.avg_runtime_ms)),
    design.section(t('pv_sec_by_agent')),
    ...(agentRows.length ? agentRows : [design.it(t('pv_costs_none_agent'))]),
    design.section(t('pv_sec_by_deal')),
    ...(dealRows.length ? dealRows : [design.it(t('pv_costs_none_deal'))]),
    design.section(t('pv_sec_forecast')),
    design.row(t('pv_row_est_monthly'), `$${(c.estimated_monthly_cents / 100).toFixed(2)}`),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton(t('pv_title_settings'), 'cc_providers'), design.textButton(t('pv_btn_team'), 'cc_workforce')],
      [design.textButton(t('common_home'), 'cc_home')]
    ])
  };
}

module.exports = { buildProviders, buildProviderPicker, buildCosts };
