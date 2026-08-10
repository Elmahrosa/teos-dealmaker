const design = require('../design');
const i18n = require('../i18n');
const audit = require('../../utils/auditLogger');
const { getMode } = require('../../config/mode');
const { getApprovalMode, MODES } = require('../../config/approval');
const { getStoreAdapter } = require('../store');
const { BOT_CONFIG } = require('../config');
const identity = require('../../services/identity');
const memory = require('../../services/memory');
const runtime = require('../../services/workforce/runtime');
const { getCtx, recentErrors } = require('./lib');

function approvalBadge(mode) {
  if (mode === 'automatic') return `🟢 ${design.b('Automatic')}`;
  if (mode === 'simulation') return `🔵 ${design.b('Simulation')}`;
  return `🟡 ${design.b('Manual')}`;
}

async function stats(userId) {
  const ctx = await getCtx(userId);
  const adapter = getStoreAdapter();
  let workspaces = [];
  let members = [];
  let users = [];
  try {
    workspaces = await adapter.find('workspaces', {});
    members = await adapter.find('workspace_members', {});
    users = await adapter.find('users', {});
  } catch (_) { /* stats best-effort */ }
  const agentCount = ctx ? ctx.agents.active : identity.AGENT_TYPES.length;
  return { ctx, adapter, workspaces, members, users, agentCount };
}

async function buildFounderHome(userId) {
  const t = key => i18n.t(userId, key);
  const s = await stats(userId);
  const entries = audit.readVault();
  const closed = s.ctx
    ? s.ctx.deals.closed
    : entries.filter(e => e.action === 'CLOSING_AGENT_DEAL_CLOSED').length;
  const open = s.ctx ? s.ctx.deals.open : 0;
  const text = design.compose([
    `👑 ${design.b(t('fd_welcome'))}`,
    design.it(t('fd_sub')),
    design.divider(),
    design.row(t('fd_system'), design.modeBadge(getMode())),
    design.row(t('fd_approval'), approvalBadge(getApprovalMode())),
    design.row(t('fd_agents'), `${s.agentCount} Active`),
    design.row(t('fd_workspaces'), String(s.workspaces.length)),
    design.row(t('fd_customers'), String(s.members.length)),
    design.row(t('fd_open'), String(open)),
    design.row(t('fd_closed'), String(closed)),
    design.divider(),
    design.it(t('fd_security_note'))
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('🎯 ' + t('fd_mission_center'), 'cc_missions'), design.textButton('🤖 ' + t('fd_workforce'), 'cc_workforce'), design.textButton('✅ ' + t('fd_approvals'), 'cc_approvals')],
      [design.textButton('📊 Mission Dashboard', 'cc_mission_dashboard'), design.textButton('➕ Create Mission', 'cc_mission_create')],
      [design.textButton('📈 ' + t('fd_revenue_title'), 'cc_fd_revenue'), design.textButton('👥 ' + t('fd_customers_title'), 'cc_fd_customers'), design.textButton('🧾 ' + t('fd_audit_center'), 'cc_audit')],
      [design.textButton('⚡ ' + t('fd_mode'), 'cc_fd_mode'), design.textButton('🛡 ' + t('fd_approval_title'), 'cc_fd_approval'), design.textButton('💳 ' + t('fd_billing_mgmt'), 'cc_fd_billing')],
      [design.textButton('🗂 ' + t('fd_workspaces_title'), 'cc_fd_workspaces'), design.textButton('🐞 ' + t('fd_debug'), 'cc_fd_debug'), design.textButton('🛡 ' + t('fd_sentinel_title'), 'cc_fd_sentinel')],
      [design.textButton('🔐 ' + t('fd_policy_title'), 'cc_fd_policy'), design.textButton('📊 ' + t('fd_analytics_title'), 'cc_fd_analytics'), design.textButton('⚙ ' + t('fd_feature_flags'), 'cc_fd_flags')],
      [design.textButton('🛑 ' + t('fd_emergency_title'), 'cc_fd_emergency'), design.textButton('🏭 ' + t('fd_enterprise_ops'), 'cc_fd_ops'), design.textButton('⚙ ' + t('settings_title'), 'cc_settings')]
    ])
  };
}

function buildFounderSystemMode(userId) {
  const t = key => i18n.t(userId, key);
  const mode = getMode();
  const text = design.compose([
    `⚡ ${design.b(t('fd_mode'))}`,
    design.it(t('fd_mode_note')),
    design.divider(),
    design.row(t('fd_system'), design.modeBadge(mode)),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('🔴 Switch to LIVE', 'cc_live')],
      [design.textButton('🟡 Switch to DRY', 'cc_dry')],
      [design.textButton(t('fd_btn_back'), 'cc_home')]
    ])
  };
}

function buildFounderApproval(userId) {
  const t = key => i18n.t(userId, key);
  const current = getApprovalMode();
  const text = design.compose([
    `🛡 ${design.b(t('fd_approval_title'))}`,
    design.row(t('fd_approval_current'), approvalBadge(current)),
    design.divider(),
    design.it(t('fd_approval_auto')),
    design.it(t('fd_approval_manual')),
    design.it(t('fd_approval_sim')),
    design.divider()
  ]);
  const rows = MODES.map(m => [
    design.textButton(`${m === current ? '●' : '○'} ${m.charAt(0).toUpperCase() + m.slice(1)}`, `cc_fd_approval_set:${m}`)
  ]);
  rows.push([design.textButton(t('fd_btn_back'), 'cc_home')]);
  return { text, keyboard: design.keyboard(rows) };
}

function buildFounderBilling(userId) {
  const t = key => i18n.t(userId, key);
  const text = design.compose([
    `💳 ${design.b(t('fd_billing'))}`,
    design.divider(),
    design.row(t('fd_plan'), 'Founder'),
    design.row(t('fd_subscription'), t('fd_unlimited')),
    design.row(t('fd_expires'), t('fd_never')),
    design.row(t('fd_status'), t('fd_active')),
    design.divider(),
    design.it(t('fd_billing_note')),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton(t('fd_btn_back'), 'cc_home')]
    ])
  };
}

async function buildFounderWorkspaces(userId) {
  const t = key => i18n.t(userId, key);
  const s = await stats(userId);
  const lines = s.workspaces.length
    ? s.workspaces.map(ws => {
      const count = s.members.filter(m => m.workspace_id === ws.id).length;
      return `${design.b(ws.name || ws.slug)} · #${ws.id}\n${design.it('plan ' + (ws.plan || 'solo') + ' · ' + (ws.status || 'active') + ' · ' + count + ' ' + t('fd_members'))}`;
    })
    : [design.it('No workspaces yet.')];
  const text = design.compose([
    `🗂 ${design.b(t('fd_workspaces_title'))}`,
    design.it(`${s.workspaces.length} workspace${s.workspaces.length === 1 ? '' : 's'} on the platform`),
    design.divider(),
    ...lines,
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton(t('fd_btn_back'), 'cc_home')]
    ])
  };
}

async function buildFounderCustomers(userId) {
  const t = key => i18n.t(userId, key);
  const s = await stats(userId);
  const lines = s.workspaces.slice(0, 8).map(ws => {
    const names = s.members
      .filter(m => m.workspace_id === ws.id)
      .map(m => {
        const u = s.users.find(u => u.id === m.user_id);
        return u ? (u.display_name || u.email || ('user #' + u.id)) : ('member #' + m.user_id);
      });
    return `${design.b(ws.name || ws.slug)} · ${names.length} ${t('fd_members')}\n${design.it(names.slice(0, 3).join(', ') || '—')}`;
  });
  const text = design.compose([
    `👥 ${design.b(t('fd_customers_title'))}`,
    design.it(`${s.members.length} customer account${s.members.length === 1 ? '' : 's'} across ${s.workspaces.length} workspace${s.workspaces.length === 1 ? '' : 's'}`),
    design.divider(),
    ...lines,
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('📈 ' + t('fd_revenue_title'), 'cc_fd_revenue')],
      [design.textButton(t('fd_btn_back'), 'cc_home')]
    ])
  };
}

async function buildFounderRevenue(userId) {
  const t = key => i18n.t(userId, key);
  const s = await stats(userId);
  const closed = s.ctx ? s.ctx.deals.closed : 0;
  const open = s.ctx ? s.ctx.deals.open : 0;
  const total = s.ctx ? s.ctx.deals.total : 0;
  const contactChannel = await latestIntakeContact();
  const text = design.compose([
    `📈 ${design.b(t('fd_revenue_title'))}`,
    design.divider(),
    design.row('Pipeline', String(total)),
    design.row(t('fd_open'), String(open)),
    design.row(t('fd_closed'), String(closed)),
    design.row(t('fd_contact_channel'), contactChannel),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Deals', 'cc_deals'), design.textButton('Pipeline', 'cc_pipeline')],
      [design.textButton('Briefing', 'cc_briefing'), design.textButton('Costs', 'cc_costs'), design.textButton('Progress', 'cc_queue')],
      [design.textButton(t('fd_btn_back'), 'cc_home')]
    ])
  };
}

// Contact channel row for the founder Revenue panel: the latest mission
// intake's contact (email/Telegram) or the canonical fallback string. This
// is founder-only output — never surfaced on any public page.
async function latestIntakeContact() {
  try {
    const adapter = getStoreAdapter();
    const rows = await adapter.find('mission_intakes', {});
    if (!rows || !rows.length) return '—';
    const { CONTACT_FALLBACK } = require('../../services/missionIntake');
    const latest = String(rows[rows.length - 1].contact || '');
    return latest || CONTACT_FALLBACK;
  } catch (_) {
    return '—';
  }
}

async function buildFounderDebug(userId) {
  const t = key => i18n.t(userId, key);
  const s = await stats(userId);
  const adapter = getStoreAdapter();
  const entries = audit.readVault();
  let running = 0;
  let memoryLines = [];
  let usage = null;
  if (s.ctx) {
    try {
      const missions = await runtime.listMissions(adapter, s.ctx.workspace.id);
      running = missions.filter(m => ['planned', 'running', 'waiting_approval'].includes(m.status)).length;
    } catch (_) { /* ignore */ }
    try {
      const mem = await memory.getMemory(adapter, s.ctx.workspace.id);
      memoryLines = memory.describe(mem).slice(0, 5);
    } catch (_) { /* ignore */ }
    try {
      const repos = require('../../db/repos').createRepos(adapter);
      usage = await repos.usage.sum(s.ctx.workspace.id);
    } catch (_) { /* ignore */ }
  }
  const last = entries[entries.length - 1];
  const blocks = [
    `🐞 ${design.b(t('fd_debug_title'))}`,
    design.row(t('fd_agents'), String(s.agentCount)),
    design.row(t('fd_running'), String(running)),
    design.row(t('fd_audit_events'), String(entries.length)),
    design.row(t('fd_recent_errors'), String(recentErrors())),
    usage ? design.row(t('fd_cost'), `$${((usage.cost_cents || 0) / 100).toFixed(2)}`) : null,
    usage ? design.row(t('fd_tokens'), `${usage.input_tokens || 0}/${usage.output_tokens || 0} in/out`) : null,
    design.section('MEMORY'),
    ...(memoryLines.length ? memoryLines.map(m => design.it(m.split(':')[0])) : [design.it('No company memory captured.')]),
    design.section('LAST ACTIVITY'),
    design.it(last ? `${last.action} · ${(last.timestamp || '').slice(11, 19)}` : 'No activity yet.')
  ];
  const text = design.compose(blocks);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Queue', 'cc_queue'), design.textButton('Costs', 'cc_costs')],
      [design.textButton('Health', 'cc_health'), design.textButton('Audit', 'cc_audit')],
      [design.textButton('Mission Center', 'cc_missions')],
      [design.textButton(t('fd_btn_back'), 'cc_home')]
    ])
  };
}

async function buildFounderOps(userId) {
  const t = key => i18n.t(userId, key);
  const hasDb = Boolean(process.env.DATABASE_URL);
  const hasBot = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const liveAllowed = Boolean(process.env.TEOS_MODE);
  const text = design.compose([
    `🏭 ${design.b(t('fd_ops_title'))}`,
    design.divider(),
    design.row(t('fd_telegram'), `${hasBot ? t('fd_connected') : t('fd_not_configured')} · @${BOT_CONFIG.botName}`),
    design.row(t('fd_supabase'), hasDb ? t('fd_connected') : t('fd_not_configured')),
    design.row(t('fd_railway'), liveAllowed ? t('fd_configured') : t('fd_not_configured')),
    design.row(t('fd_dodo'), process.env.DODO_STARTER_MONTHLY_URL ? t('fd_configured') : t('fd_not_configured')),
    design.divider(),
    design.it(t('fd_security_note'))
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('🧾 ' + t('fd_audit_center'), 'cc_audit'), design.textButton('🩺 ' + t('health_title'), 'cc_health')],
      [design.textButton('🔐 Policies', 'cc_providers')],
      [design.textButton(t('fd_btn_back'), 'cc_home')]
    ])
  };
}

function buildFounderSentinel(userId) {
  const t = key => i18n.t(userId, key);
  const text = design.compose([
    `🛡 ${design.b(t('fd_sentinel_title'))}`,
    design.it('Security layers stay on for every action — including Founder operations.'),
    design.divider(),
    design.row('Policy enforcement', t('fd_active')),
    design.row('Prompt security', t('fd_active')),
    design.row('Continuous audit', t('fd_active')),
    design.row('Compliance log', t('fd_active')),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('🧠 Company Intelligence', 'cc_intelligence'), design.textButton('🔐 Policies', 'cc_providers')],
      [design.textButton(t('fd_btn_back'), 'cc_home')]
    ])
  };
}

function buildFounderPolicy(userId) {
  const t = key => i18n.t(userId, key);
  const text = design.compose([
    `🔐 ${design.b(t('fd_policy_title'))}`,
    design.it(t('fd_policy_note')),
    design.divider(),
    design.row(t('fd_policy_engine'), t('fd_active')),
    design.row(t('fd_policy_rbac'), t('fd_active')),
    design.row(t('fd_policy_entitlements'), t('fd_active')),
    design.row(t('fd_policy_capabilities'), t('fd_active')),
    design.row(t('fd_policy_audit'), t('fd_active')),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton(t('fd_policy_btn'), 'cc_providers')],
      [design.textButton(t('fd_btn_back'), 'cc_home')]
    ])
  };
}

async function buildFounderAnalytics(userId) {
  const t = key => i18n.t(userId, key);
  const s = await stats(userId);
  const entries = audit.readVault();
  const closed = s.ctx ? s.ctx.deals.closed : 0;
  const open = s.ctx ? s.ctx.deals.open : 0;
  let usage = null;
  if (s.ctx) {
    try {
      const repos = require('../../db/repos').createRepos(getStoreAdapter());
      usage = await repos.usage.sum(s.ctx.workspace.id);
    } catch (_) { /* ignore */ }
  }
  const text = design.compose([
    `📊 ${design.b(t('fd_analytics_title'))}`,
    design.it(t('fd_analytics_note')),
    design.divider(),
    design.row(t('fd_analytics_total'), String(s.workspaces.length)),
    design.row(t('fd_analytics_customers'), String(s.members.length)),
    design.row(t('fd_analytics_revenue'), `${open} open · ${closed} closed`),
    design.row(t('fd_analytics_audit'), String(entries.length)),
    usage ? design.row(t('fd_analytics_cost'), `$${((usage.cost_cents || 0) / 100).toFixed(2)}`) : null,
    usage ? design.row(t('fd_analytics_tokens'), `${usage.input_tokens || 0}/${usage.output_tokens || 0}`) : null,
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('📈 ' + t('fd_revenue_title'), 'cc_fd_revenue')],
      [design.textButton(t('fd_btn_back'), 'cc_home')]
    ])
  };
}

function buildFounderFlags(userId) {
  const t = key => i18n.t(userId, key);
  const flags = require('../../config/flags');
  const current = flags.list();
  const labels = {
    missions: t('fd_flags_missions'),
    sales: t('fd_flags_sales'),
    pipeline: t('fd_flags_pipeline'),
    intelligence: t('fd_flags_intelligence'),
    integrations: t('fd_flags_integrations')
  };
  const lines = Object.keys(labels).map(key =>
    design.row(labels[key], current[key] !== false ? `🟢 ${t('fd_enabled')}` : `⚪ ${t('fd_disabled')}`)
  );
  const text = design.compose([
    `⚙ ${design.b(t('fd_flags_title'))}`,
    design.it(t('fd_flags_note')),
    design.divider(),
    ...lines,
    design.divider()
  ]);
  const rows = Object.keys(labels).map(key => [
    design.textButton(`${current[key] !== false ? '●' : '○'} ${labels[key]}`, `cc_fd_flags_set:${key}`)
  ]);
  rows.push([design.textButton(t('fd_btn_back'), 'cc_home')]);
  return { text, keyboard: design.keyboard(rows) };
}

function buildFounderEmergency(userId) {
  const t = key => i18n.t(userId, key);
  const emergency = require('../../config/emergency');
  const engaged = emergency.isEngaged();
  const text = design.compose([
    `🛑 ${design.b(t('fd_emergency_title'))}`,
    design.it(t('fd_emergency_note')),
    design.divider(),
    design.row(t('fd_emergency_status'), engaged ? `🔴 ${design.b(t('fd_emergency_engaged'))}` : `🟢 ${t('fd_emergency_disengaged')}`),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      engaged
        ? [design.textButton(t('fd_emergency_resume_btn'), 'cc_fd_emergency_resume')]
        : [design.textButton(t('fd_emergency_stop_btn'), 'cc_fd_emergency_stop')],
      [design.textButton(t('fd_btn_back'), 'cc_home')]
    ])
  };
}

module.exports = {
  buildFounderHome,
  buildFounderSystemMode,
  buildFounderApproval,
  buildFounderBilling,
  buildFounderWorkspaces,
  buildFounderCustomers,
  buildFounderRevenue,
  buildFounderDebug,
  buildFounderOps,
  buildFounderSentinel,
  buildFounderPolicy,
  buildFounderAnalytics,
  buildFounderFlags,
  buildFounderEmergency
};
