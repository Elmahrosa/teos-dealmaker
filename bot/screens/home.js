const design = require('../design');
const audit = require('../../utils/auditLogger');
const { BOT_CONFIG } = require('../config');
const { isFounder, isAdmin } = require('../access');
const { getStoreAdapter } = require('../store');
const learning = require('../../services/learning');
const runtime = require('../../services/workforce/runtime');
const i18n = require('../i18n');
const {
  getCtx,
  lastEntry,
  titleCase,
  greetingFor,
  recentErrors
} = require('./lib');
const { buildLearn } = require('./learning');

async function buildHome(userId) {
  const t = key => i18n.t(userId, key);
  if (isFounder(userId)) {
    return require('./founder').buildFounderHome(userId);
  }
  const ctx = await getCtx(userId);
  const isAdminOrFounder = isAdmin(userId) || isFounder(userId);
  if (!ctx) {
    const entryCount = audit.countEntries();
    const text = design.compose([
      `${design.EMOJI.ai} ${design.b('TEOS DEALMAKER')}`,
      design.it(t('home_sub_mission_control')),
      design.divider(),
      `${design.row(t('home_row_platform'), t('home_val_production'))}`,
      `${design.row(t('home_row_revenue_team'), t('home_val_13_spec'))}`,
      `${design.row(t('home_row_audit'), i18n.sprintf(t('home_val_entries'), entryCount))}\n${design.divider()}`,
      `${design.it(t('home_help_select'))}`
    ]);
    const row1 = [design.textButton(t('btn_dashboard'), 'cc_dashboard'), design.textButton(t('btn_revenue_team'), 'cc_workforce')];
    const row2 = [design.textButton(t('btn_sales_pipeline'), 'cc_pipeline'), design.textButton(t('btn_deals'), 'cc_deals')];
    const row3 = [design.textButton(t('btn_timeline'), 'cc_timeline'), design.textButton(t('btn_costs'), 'cc_costs'), design.textButton(t('btn_health'), 'cc_health')];
    const row4 = [];
    if (isAdminOrFounder) {
      row4.push(design.textButton(t('btn_audit'), 'cc_audit'));
    }
    row4.push(design.textButton(t('btn_pricing'), 'cc_pricing'), design.textButton(t('btn_playground'), 'cc_playground'));
    const row5 = [];
    if (isAdminOrFounder) {
      row5.push(design.textButton(t('btn_admin'), 'cc_admin'));
    }
    return {
      text,
      keyboard: design.keyboard([row1, row2, row3, row4, row5])
    };
  }
  const adapter = getStoreAdapter();
  const progress = await learning.progress(adapter, ctx.workspace.id);
  if (!progress.complete) {
    return buildLearn(userId, progress, ctx);
  }
  const name = (ctx.user && ctx.user.display_name) || 'there';
  const timezone = (ctx.settings && ctx.settings.timezone) || 'UTC';
  const healthy = ctx.agents.active === ctx.agents.total && recentErrors() === 0;
  const missions = await runtime.listMissions(adapter, ctx.workspace.id);
  const running = missions.filter(m => ['planned', 'running', 'waiting_approval'].includes(m.status)).length;
  const completed = missions.filter(m => m.status === 'completed').length;
  const nextMission = missions.find(m => !['completed', 'failed', 'cancelled'].includes(m.status));
  const recommendation = nextMission
    ? `${nextMission.title} · ${nextMission.progress}% · next: ${nextMission.next_agent || '—'}`
    : t('home_recommend_empty');
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('home_title'))}`,
    design.it(`${greetingFor(timezone)}, ${name}.`),
    design.divider(),
    design.section(t('home_sect_missions')),
    design.row(t('home_row_inflight'), String(running)),
    design.row(t('home_row_completed'), String(completed)),
    design.section(t('home_sect_workforce')),
    `${healthy ? design.EMOJI.success : design.EMOJI.warning} ${i18n.sprintf(t('home_agents_ready'), ctx.agents.active, ctx.deals.open)}`,
    design.section(t('home_sect_next')),
    design.it(recommendation),
    design.divider()
  ]);
  if (isAdminOrFounder) {
    return {
      text,
      keyboard: design.keyboard([
        [design.textButton(t('btn_mission1'), 'cc_mission1'), design.textButton(t('btn_new_mission'), 'cc_mission_goal')],
        [design.textButton(t('btn_mission_center'), 'cc_missions'), design.textButton(t('btn_approvals'), 'cc_approvals')],
        [design.textButton(t('btn_sales_pipeline'), 'cc_pipeline'), design.textButton(t('btn_revenue_team'), 'cc_workforce')],
        [design.textButton(t('btn_activity'), 'cc_activity'), design.textButton(t('btn_daily_summary'), 'cc_briefing'), design.textButton(t('btn_costs'), 'cc_costs')],
        [design.textButton(t('btn_health'), 'cc_health'), design.textButton(t('btn_intelligence'), 'cc_intelligence'), design.textButton(t('btn_integrations'), 'cc_integrations')],
        [design.textButton(t('btn_playground'), 'cc_playground'), design.textButton(t('btn_pricing'), 'cc_pricing'), design.textButton(t('btn_settings'), 'cc_settings'), design.textButton(t('btn_audit'), 'cc_audit'), design.textButton(t('btn_admin'), 'cc_admin')]
      ])
    };
  }
  const allowedButtons = [
    { text: t('btn_mission1'), callback: 'cc_mission1' },
    { text: t('btn_new_mission'), callback: 'cc_mission_goal' },
    { text: t('btn_mission_center'), callback: 'cc_missions' },
    { text: t('btn_approvals'), callback: 'cc_approvals' },
    { text: t('btn_company_intelligence'), callback: 'cc_intelligence' },
    { text: t('btn_pipeline'), callback: 'cc_pipeline' },
    { text: t('btn_playground'), callback: 'cc_playground' },
    { text: t('btn_settings'), callback: 'cc_settings' }
  ];
  const rows = [];
  for (let i = 0; i < allowedButtons.length; i += 2) {
    const pair = allowedButtons.slice(i, i + 2);
    const row = pair.map(b => design.textButton(b.text, b.callback));
    rows.push(row);
  }
  return {
    text,
    keyboard: design.keyboard(rows)
  };
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
    `${design.code((e.timestamp || '').slice(11, 19))} ${e.action} → ${e.target}`
  );
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('btn_dashboard'))}`,
    design.it(t('dash_operational')),
    design.divider(),
    ctx ? design.row(t('settings_workspace'), ctx.workspace.name) : null,
    design.row(t('dash_bot'), `@${BOT_CONFIG.botName}`),
    ctx ? design.row(t('dash_plan'), titleCase(ctx.workspace.plan)) : null,
    ctx ? design.row(t('dash_members'), String(ctx.membersCount)) : null,
    ctx ? design.row(t('dash_agents'), i18n.sprintf(t('dash_agents_active'), ctx.agents.active)) : null,
    ctx ? design.row(t('dash_sub_status'), ctx.subscriptionLabel) : null,
    design.row(t('home_row_audit'), i18n.sprintf(t('home_val_entries'), entryCount)),
    design.row(t('home_row_closed_deals'), `${closed}`),
    design.row(t('health_last'), last ? `${last.action} · ${(last.timestamp || '').slice(11, 19)}` : '—'),
    design.section(t('home_sect_recent')),
    recent.length ? design.list(recent) : design.it(t('home_no_activity')),
    design.section(t('home_sect_quick'))
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton(t('btn_run_sales_flow'), 'cc_sales_run'), design.textButton(t('btn_run_pipeline'), 'cc_pipeline_run')],
      [design.textButton(t('btn_audit'), 'cc_audit'), design.textButton(t('btn_back_home'), 'cc_home')]
    ])
  };
}

module.exports = { buildHome, buildDashboard };
