const design = require('../design');
const audit = require('../../utils/auditLogger');
const { BOT_CONFIG } = require('../config');
const { isFounder } = require('../access');
const i18n = require('../i18n');
const {
  getCtx,
  lastEntry,
  titleCase,
  greetingFor,
  recentErrors
} = require('./lib');

async function buildHome(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (isFounder(userId) && !ctx) {
    return require('./founder').buildFounderHome(userId);
  }
  if (!ctx) {
    // No workspace yet: the first thing a new user sees is Quick Start.
    return require('../onboarding').start(userId);
  }
  const name = (ctx.user && ctx.user.display_name) || 'there';
  const timezone = (ctx.settings && ctx.settings.timezone) || 'UTC';
  const healthy = ctx.agents.active === ctx.agents.total && recentErrors() === 0;
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('home_title'))}`,
    design.it(`${greetingFor(timezone)}, ${design.esc(name)}.`),
    design.divider(),
    design.row(t('home_row_open_deals'), String(ctx.deals.open)),
    design.row(t('home_row_closed_deals'), String(ctx.deals.closed)),
    `${healthy ? design.EMOJI.success : design.EMOJI.warning} ${i18n.sprintf(t('home_agents_ready'), ctx.agents.active, ctx.deals.open)}`,
    design.divider(),
    design.it(t('home_recommend_empty')),
    design.it(t('home_hint'))
  ]);
  // One simple home for everyone. Missions, approvals and the internal
  // control panels are not offered here; the founder reaches them through
  // the gated Founder Console button.
  const rows = [
    [design.textButton(t('btn_run_pipeline'), 'cc_pipeline_run'), design.textButton(t('btn_deals'), 'cc_deals')],
    [design.textButton(t('btn_pipeline'), 'cc_pipeline'), design.textButton(t('btn_dashboard'), 'cc_dashboard')],
    [design.textButton(t('btn_company_intelligence'), 'cc_intelligence'), design.textButton(t('btn_playground'), 'cc_playground')],
    [design.textButton(t('btn_settings'), 'cc_settings')]
  ];
  if (isFounder(userId)) {
    rows.push([design.textButton(t('btn_founder_console'), 'cc_founder')]);
  }
  return { text, keyboard: design.keyboard(rows) };
}

async function buildDashboard(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  const entryCount = audit.countEntries();
  const last = lastEntry();
  const closed = ctx
    ? ctx.deals.closed
    : audit.readVault().filter(e => e.action === 'CLOSING_AGENT_DEAL_CLOSED').length;
  const recent = audit.readTail(3).reverse().map(e =>
    `${design.code((e.timestamp || '').slice(11, 19))} ${design.esc(e.action)} → ${design.esc(e.target)}`
  );
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('btn_dashboard'))}`,
    design.it(t('dash_operational')),
    design.divider(),
    ctx ? design.row(t('settings_workspace'), design.esc(ctx.workspace.name)) : null,
    design.row(t('dash_bot'), `@${design.esc(BOT_CONFIG.botName)}`),
    ctx ? design.row(t('dash_plan'), design.esc(titleCase(ctx.workspace.plan))) : null,
    ctx ? design.row(t('dash_members'), String(ctx.membersCount)) : null,
    ctx ? design.row(t('dash_agents'), i18n.sprintf(t('dash_agents_active'), ctx.agents.active)) : null,
    ctx ? design.row(t('dash_sub_status'), design.esc(ctx.subscriptionLabel)) : null,
    design.row(t('home_row_audit'), i18n.sprintf(t('home_val_entries'), entryCount)),
    design.row(t('home_row_closed_deals'), `${closed}`),
    design.row(t('health_last'), last ? `${design.esc(last.action)} · ${(last.timestamp || '').slice(11, 19)}` : '—'),
    design.section(t('home_sect_recent')),
    recent.length ? design.list(recent) : design.it(t('home_no_activity')),
    design.section(t('home_sect_quick'))
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [
        ...(isFounder(userId) ? [design.textButton(t('btn_run_sales_flow'), 'cc_sales_run')] : []),
        design.textButton(t('btn_run_pipeline'), 'cc_pipeline_run')
      ],
      [design.textButton(t('btn_audit'), 'cc_audit'), design.textButton(t('btn_back_home'), 'cc_home')]
    ])
  };
}

module.exports = { buildHome, buildDashboard };
