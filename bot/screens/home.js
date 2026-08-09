const design = require('../design');
const audit = require('../../utils/auditLogger');
const { BOT_CONFIG } = require('../config');
const { isFounder, isAdmin } = require('../access');
const { getStoreAdapter } = require('../store');
const learning = require('../../services/learning');
const runtime = require('../../services/workforce/runtime');
const {
  getCtx,
  lastEntry,
  titleCase,
  greetingFor,
  recentErrors
} = require('./lib');
const { buildLearn } = require('./learning');

async function buildHome(userId) {
  if (isFounder(userId)) {
    return require('./founder').buildFounderHome(userId);
  }
  const ctx = await getCtx(userId);
  const isAdminOrFounder = isAdmin(userId) || isFounder(userId);
  if (!ctx) {
    const entries = audit.readVault();
    const text = design.compose([
      `${design.EMOJI.ai} ${design.b('TEOS DEALMAKER')}`,
      design.it('Mission Control — AI Revenue Workforce'),
      design.divider(),
      `${design.row('Platform', 'Production · live')}`,
      `${design.row('Revenue Team', '13 specialists available')}`,
      `${design.row('Audit', `${entries.length} entries`)}\n${design.divider()}`,
      `${design.it('Select a module to manage the workforce.')}`
    ]);
    const row1 = [design.textButton('Dashboard', 'cc_dashboard'), design.textButton('My Revenue Team', 'cc_workforce')];
    const row2 = [design.textButton('Sales Pipeline', 'cc_pipeline'), design.textButton('Deals', 'cc_deals')];
    const row3 = [design.textButton('Timeline', 'cc_timeline'), design.textButton('Costs', 'cc_costs'), design.textButton('Health', 'cc_health')];
    const row4 = [];
    if (isAdminOrFounder) {
      row4.push(design.textButton('Audit Log', 'cc_audit'));
    }
    row4.push(design.textButton('Pricing', 'cc_pricing'), design.textButton('Playground', 'cc_playground'));
    const row5 = [];
    if (isAdminOrFounder) {
      row5.push(design.textButton('Admin', 'cc_admin'));
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
    : 'Start Mission 1 to define your sales strategy.';
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('MISSION CONTROL')}`,
    design.it(`${greetingFor(timezone)}, ${name}.`),
    design.divider(),
    design.section('MISSIONS'),
    design.row('In flight', String(running)),
    design.row('Completed', String(completed)),
    design.section('WORKFORCE'),
    `${healthy ? design.EMOJI.success : design.EMOJI.warning} ${ctx.agents.active} agents ready · ${ctx.deals.open} active deals`,
    design.section('NEXT ACTION'),
    design.it(recommendation),
    design.divider()
  ]);
  if (isAdminOrFounder) {
    return {
      text,
      keyboard: design.keyboard([
        [design.textButton('Mission 1 · Sell TEOS Dealmaker', 'cc_mission1'), design.textButton('New Mission', 'cc_mission_goal')],
        [design.textButton('Mission Center', 'cc_missions'), design.textButton('Approvals', 'cc_approvals')],
        [design.textButton('Sales Pipeline', 'cc_pipeline'), design.textButton('My Revenue Team', 'cc_workforce')],
        [design.textButton('Activity', 'cc_activity'), design.textButton('Daily Summary', 'cc_briefing'), design.textButton('Costs', 'cc_costs')],
        [design.textButton('Health', 'cc_health'), design.textButton('Intelligence', 'cc_intelligence'), design.textButton('Integrations', 'cc_integrations')],
        [design.textButton('Playground', 'cc_playground'), design.textButton('Pricing', 'cc_pricing'), design.textButton('Settings', 'cc_settings'), design.textButton('Audit Log', 'cc_audit'), design.textButton('Admin', 'cc_admin')]
      ])
    };
  }
  const allowedButtons = [
    { text: 'Mission 1 · Sell TEOS Dealmaker', callback: 'cc_mission1' },
    { text: 'New Mission', callback: 'cc_mission_goal' },
    { text: 'Mission Center', callback: 'cc_missions' },
    { text: 'Approvals', callback: 'cc_approvals' },
    { text: 'Company Intelligence', callback: 'cc_intelligence' },
    { text: 'Pipeline', callback: 'cc_pipeline' },
    { text: 'Playground', callback: 'cc_playground' },
    { text: 'Settings', callback: 'cc_settings' }
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
  const ctx = await getCtx(userId);
  const entries = audit.readVault();
  const last = lastEntry();
  const closed = ctx
    ? ctx.deals.closed
    : entries.filter(e => e.action === 'CLOSING_AGENT_DEAL_CLOSED').length;
  const recent = entries.slice(-3).reverse().map(e =>
    `${design.code((e.timestamp || '').slice(11, 19))} ${e.action} → ${e.target}`
  );
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Dashboard')}`,
    design.it('Operational overview'),
    design.divider(),
    ctx ? design.row('Workspace', ctx.workspace.name) : null,
    design.row('Bot', `@${BOT_CONFIG.botName}`),
    ctx ? design.row('Plan', titleCase(ctx.workspace.plan)) : null,
    ctx ? design.row('Members', String(ctx.membersCount)) : null,
    ctx ? design.row('Agents', `${ctx.agents.active} active`) : null,
    ctx ? design.row('Subscription', ctx.subscriptionLabel) : null,
    design.row('Audit', `${entries.length} entries`),
    design.row('Closed deals', `${closed}`),
    design.row('Last activity', last ? `${last.action} · ${(last.timestamp || '').slice(11, 19)}` : '—'),
    design.section('RECENT ACTIVITY'),
    recent.length ? design.list(recent) : design.it('No activity yet.'),
    design.section('QUICK ACTIONS')
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Run Sales Flow', 'cc_sales_run'), design.textButton('Run Pipeline', 'cc_pipeline_run')],
      [design.textButton('Audit Log', 'cc_audit'), design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

module.exports = { buildHome, buildDashboard };
