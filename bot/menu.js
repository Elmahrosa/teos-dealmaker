const design = require('./design');
const audit = require('../utils/auditLogger');
const { getMode, setMode } = require('../config/mode');
const { BOT_CONFIG } = require('./config');
const { isFounder, isAdmin } = require('./access');
const i18n = require('./i18n');
const { formatPricingText, pricingButtons } = require('../config/pricing.config');
const { getWorkspaceContext, setWorkspaceLang } = require('../services/workspace');
const { getStoreAdapter } = require('./store');

const AGENTS = [
  { name: 'Orchestrator', prefix: 'ORCHESTRATOR', role: 'Routing and control' },
  { name: 'Prospecting', prefix: 'PROSPECTING_AGENT', role: 'Lead scoring and routing' },
  { name: 'Market Intelligence', prefix: 'MARKET_INTELLIGENCE', role: 'Prospect fit scoring' },
  { name: 'Qualification', prefix: 'QUALIFICATION_AGENT', role: 'BANT classification' },
  { name: 'Outreach', prefix: 'OUTREACH', role: 'Draft review and dispatch' },
  { name: 'Strategist', prefix: 'STRATEGIST_AGENT', role: 'Tactical playbooks' },
  { name: 'Marketer', prefix: 'MARKETER_AGENT', role: 'Value positioning' },
  { name: 'Sales', prefix: 'SALES', role: 'Objection handling' },
  { name: 'Negotiator', prefix: 'NEGOTIATOR_AGENT', role: 'Thresholds and terms' },
  { name: 'Treasurer', prefix: 'TREASURER_AGENT', role: 'Contracts and checkout' },
  { name: 'Gatekeeper', prefix: 'GATEKEEPER', role: 'Safety review' },
  { name: 'Closing', prefix: 'CLOSING_AGENT', role: 'Readiness to won/blocked' }
];

const PIPELINE_STAGES = ['Strategist', 'Marketer', 'Negotiator', 'Treasurer', 'Closing'];

function activityCount(prefix) {
  return audit.readVault().filter(e => e.action.startsWith(prefix)).length;
}

function statusOf(prefix) {
  const count = activityCount(prefix);
  return count > 0 ? design.badge('success') : design.badge('info');
}

function lastEntry() {
  const entries = audit.readVault();
  if (entries.length === 0) return null;
  return entries[entries.length - 1];
}

async function getCtx(userId) {
  try {
    return await getWorkspaceContext(getStoreAdapter(), userId);
  } catch (err) {
    console.error('[menu] context failed:', err.message);
    return null;
  }
}

function titleCase(str) {
  return String(str || '').replace(/\b\w/g, c => c.toUpperCase());
}

async function buildHome(userId) {
  const ctx = await getCtx(userId);
  if (ctx) {
    const text = design.compose([
      `🏢 ${design.b(`Welcome to ${ctx.workspace.name}`)}`,
      design.it('Workspace Ready'),
      design.divider(),
      design.row('Plan', titleCase(ctx.workspace.plan)),
      design.row('Members', String(ctx.membersCount)),
      design.row('Agents', `${ctx.agents.active} Active`),
      design.row('Revenue Pipeline', ctx.deals.total === 0 ? 'Empty' : `${ctx.deals.open} open · ${ctx.deals.closed} closed`),
      design.row('Subscription', ctx.subscriptionLabel),
      design.divider(),
      design.it('What would you like to do?')
    ]);
    return {
      text,
      keyboard: design.keyboard([
        [design.textButton('Find Leads', 'cc_workforce'), design.textButton('AI Guide', 'cc_ai_guide')],
        [design.textButton('Deals', 'cc_deals'), design.textButton('Settings', 'cc_settings')],
        [design.textButton('Dashboard', 'cc_dashboard'), design.textButton('Pipeline', 'cc_pipeline')],
        [design.textButton('Audit Log', 'cc_audit'), design.textButton('Pricing', 'cc_pricing')],
        [design.textButton('Admin', 'cc_admin')]
      ])
    };
  }
  const entries = audit.readVault();
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('TEOS DEALMAKER')}`,
    design.it('AI Revenue Workforce — Control Center'),
    design.divider(),
    `${design.row('Status', design.modeBadge(getMode()))}`,
    `${design.row('Workforce', '12 agents available')}`,
    `${design.row('Audit', `${entries.length} entries`)}\n${design.divider()}`,
    `${design.it('Select a module to manage the workforce.')}`
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Dashboard', 'cc_dashboard'), design.textButton('Workforce', 'cc_workforce')],
      [design.textButton('Pipeline', 'cc_pipeline'), design.textButton('Deals', 'cc_deals')],
      [design.textButton('Audit Log', 'cc_audit'), design.textButton('Pricing', 'cc_pricing')],
      [design.textButton('Admin', 'cc_admin')]
    ])
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
    design.row('Mode', design.modeBadge(getMode())),
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
      [design.textButton('Run Sales Demo', 'cc_sales_run'), design.textButton('Run Pipeline', 'cc_pipeline_run')],
      [design.textButton('Audit Log', 'cc_audit'), design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildWorkforce(userId) {
  const ctx = await getCtx(userId);
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Workforce')}`,
    design.it(ctx ? `${ctx.agents.active} agents active` : '12 agents — activity per agent'),
    design.divider(),
    ...AGENTS.map(a =>
      `${design.row(a.name, statusOf(a.prefix))}\n${design.it(a.role)}`
    ),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function buildPipeline() {
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Pipeline')}`,
    design.it('Final deal flow — 5 stages'),
    design.divider(),
    design.progressBar(PIPELINE_STAGES, -1).join('\n'),
    design.divider(),
    design.it('Run the demo to execute all five agents and record the result to the audit vault.')
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Run Pipeline Demo', 'cc_pipeline_run')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildDeals(userId) {
  const ctx = await getCtx(userId);
  const entries = audit.readVault();
  const closed = ctx
    ? ctx.deals.closed
    : entries.filter(e => e.action === 'CLOSING_AGENT_DEAL_CLOSED').length;
  const dbConfigured = Boolean(process.env.DATABASE_URL);
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Deals')}`,
    design.it('Deal ledger'),
    design.divider(),
    design.row('Open', ctx ? String(ctx.deals.open) : '—'),
    design.row('Closed', `${closed}`),
    design.row('Persistence', dbConfigured ? design.badge('success') : design.badge('warning') + ' ' + design.it('Postgres not configured')),
    design.section('NOTES'),
    design.it('Run the pipeline demo to record a deal through Strategist → Closing.'),
    design.it(dbConfigured
      ? 'Postgres persistence active via DATABASE_URL.'
      : 'Set DATABASE_URL and run `npm run db:migrate` to persist deals.')
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Run Pipeline Demo', 'cc_pipeline_run')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function buildAiGuide() {
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('AI Guide')}`,
    design.it('How your AI workforce works'),
    design.divider(),
    design.section('WORKFORCE'),
    design.it('12 specialized agents run your revenue motion: Prospecting → Qualification → Outreach → Sales → Negotiation → Treasurer → Closing.'),
    design.section('FLOW'),
    design.it('A deal moves Lead → Qualified → Meeting → Proposal → Negotiation → Won → Customer. Agents advance it automatically.'),
    design.section('CONTROL'),
    design.it('Run /sales <objection> to test the orchestrator. Open Workforce for per-agent activity.'),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildSettings(userId) {
  const ctx = await getCtx(userId);
  const s = (ctx && ctx.settings) || { lang: 'en', timezone: 'UTC', notifications: 'on', theme: 'system' };
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Settings')}`,
    design.it('Workspace configuration'),
    design.divider(),
    design.row('Language', s.lang),
    design.row('Timezone', s.timezone),
    design.row('Notifications', s.notifications),
    design.row('Theme', s.theme),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('English', 'cc_set_lang:en'), design.textButton('العربية', 'cc_set_lang:ar')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function statusEmoji(status) {
  if (['success', 'won', 'closed', 'SENT', 'APPROVE', 'dry_run'].includes(status)) return 'success';
  if (['dry_run', 'info', 'VAULTED_DRY'].includes(status)) return 'info';
  if (['in_progress', 'warning'].includes(status)) return 'warning';
  if (['error', 'denied', 'blocked', 'CRITICAL'].includes(status)) return 'critical';
  return 'info';
}

function buildAudit(offset) {
  const size = 8;
  const entries = audit.readVault();
  const start = Math.max(0, entries.length - size - (offset || 0));
  const page = entries.slice(start, start + size).reverse();
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Audit Log')}`,
    design.it('Immutable activity feed'),
    design.divider(),
    ...(page.length ? page.map(e =>
      `${design.code((e.timestamp || '').slice(11, 19))} ${e.action} → ${e.target}\n${design.badge(statusEmoji(e.status))}`
    ) : [design.it('No entries.')]),
    design.divider()
  ]);
  const rows = [];
  if (start > 0) rows.push([design.textButton('Earlier', `cc_audit:${(offset || 0) + size}`)]);
  rows.push([design.textButton('Back to Home', 'cc_home')]);
  return { text, keyboard: design.keyboard(rows) };
}

function buildPricing() {
  return {
    text: formatPricingText(),
    keyboard: design.keyboard([
      ...pricingButtons().inline_keyboard,
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function buildAdmin(userId) {
  const mode = getMode();
  const rows = [];
  const body = [
    `${design.EMOJI.ai} ${design.b('Admin')}`,
    design.it('Operational control'),
    design.divider(),
    design.row('Mode', design.modeBadge(mode)),
    design.row('Role', isFounder(userId) ? design.badge('success') + ' Founder' : isAdmin(userId) ? design.badge('info') + ' Admin' : design.badge('warning') + ' Operator'),
    design.divider()
  ];
  if (isFounder(userId)) rows.push([design.textButton('Switch to LIVE', 'cc_live')]);
  if (isAdmin(userId)) rows.push([design.textButton('Switch to DRY', 'cc_dry')]);
  if (isAdmin(userId)) rows.push([design.textButton('Audit Log', 'cc_audit')]);
  rows.push([design.textButton('Back to Home', 'cc_home')]);
  return { text: design.compose(body), keyboard: design.keyboard(rows) };
}

function buildSalesDemo() {
  const { runSalesFlow } = require('../agents/orchestrator');
  const result = runSalesFlow('The price is too high for our budget.', 'bot_demo');
  const lines = [
    `${design.EMOJI.ai} ${design.b('Sales Demo')}`,
    design.it('Orchestrator → Sales → Gatekeeper'),
    design.divider(),
    design.row('Objection', result.draft.objectionType),
    design.row('Gatekeeper', design.badge(result.review.decision === 'APPROVE' ? 'success' : 'warning')),
    design.row('Draft', design.code(result.draft.draft.slice(0, 80))),
    design.row('Route', result.routed ? result.routed.status : 'blocked'),
    design.divider()
  ];
  return {
    text: design.compose(lines),
    keyboard: design.keyboard([
      [design.textButton('Run Again', 'cc_sales_run')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildPipelineDemo() {
  const { buildPlaybook } = require('../agents/strategist');
  const { craftPositioning } = require('../agents/marketer');
  const { buildTerms } = require('../agents/negotiator');
  const { draftContract, createCheckout, closeDeal } = require('../agents/treasurer');
  const { closeDeal: closingAgent } = require('../agents/closing');

  const lead = {
    id: 'deal_bot_' + Date.now(),
    company: 'Control Center Demo',
    contactName: 'Enterprise Operator',
    product: 'TEOS DealMaker Sovereign License',
    classification: 'Hot',
    fitScore: 92,
    budget: 15000,
    competitivePressure: 'low',
    industry: 'Technology',
    currency: 'USD',
    termMonths: 12,
    paymentMethod: 'invoice'
  };
  const targetPrice = 12500;

  const playbook = buildPlaybook(lead);
  const positioning = craftPositioning(lead, playbook);
  const terms = buildTerms(lead, targetPrice, lead.budget);
  const deal = { ...lead, amount: terms.landingPrice };
  const contract = draftContract(deal);
  const checkout = await createCheckout(deal, contract);
  closeDeal(deal, contract, checkout);
  const closed = closingAgent({
    id: lead.id,
    company: lead.company,
    amount: terms.landingPrice,
    currency: 'USD',
    contractId: contract.contractId,
    approved: true,
    paymentMethod: 'invoice'
  });

  const lines = [
    `${design.EMOJI.ai} ${design.b('Pipeline Demo')}`,
    design.it('Strategist → Marketer → Negotiator → Treasurer → Closing'),
    design.divider(),
    design.row('Strategy', playbook.style),
    design.row('Positioning', positioning.headline),
    design.row('Landing price', `$${terms.landingPrice}`),
    design.row('Terms', terms.suggestedTerms),
    design.row('Contract', contract.contractId),
    design.row('Checkout', checkout ? checkout.url : 'blocked'),
    design.row('Outcome', design.badge(closed.status === 'won' ? 'success' : 'critical')),
    design.divider()
  ];
  return {
    text: design.compose(lines),
    keyboard: design.keyboard([
      [design.textButton('Run Again', 'cc_pipeline_run')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function modeConfirm(mode) {
  const live = mode === 'LIVE';
  const target = live ? 'LIVE' : 'DRY';
  return design.confirmPanel(
    `Switch to ${target} mode?`,
    `${design.it(live
      ? 'Messages will be dispatched to customers without vault-only protection.'
      : 'All agent output will be vaulted and nothing is sent to customers.')}\n\n${design.row('Current mode', design.modeBadge(getMode()))}`,
    live ? 'cc_live_confirm' : 'cc_dry_confirm',
    live ? 'cc_live_cancel' : 'cc_dry_cancel',
    `Switch to ${target}`,
    'Cancel'
  );
}

async function applyMode(query, bot, mode) {
  setMode(mode);
  audit.writeEntry('BOT_MODE', 'system', 'success', { mode, by: query.from ? query.from.id : null });
  await editPanel(bot, query, buildAdmin(query.from ? query.from.id : null));
}

async function editPanel(bot, query, screen) {
  await bot.editMessageText(screen.text, {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: screen.keyboard
  });
}

async function handleCallback(query, bot) {
  const action = query.data || '';
  const userId = query.from ? query.from.id : null;
  audit.writeEntry('BOT_CALLBACK', action, 'success', { userId });

  try {
    await bot.answerCallbackQuery(query.id, { text: 'OK' });
  } catch (_) { /* ignore */ }

  const send = async screen => editPanel(bot, query, screen);

  switch (action) {
    case 'cc_home':
    case 'btn_back':
      return send(await buildHome(userId));
    case 'cc_dashboard':
      return send(await buildDashboard(userId));
    case 'cc_workforce':
      return send(await buildWorkforce(userId));
    case 'cc_pipeline':
      return send(buildPipeline());
    case 'cc_deals':
      return send(await buildDeals(userId));
    case 'cc_pricing':
      return send(buildPricing());
    case 'cc_ai_guide':
      return send(buildAiGuide());
    case 'cc_settings':
      return send(await buildSettings(userId));
    case 'cc_audit': {
      if (!isAdmin(userId)) return send(denied('audit feed'));
      return send(buildAudit(0));
    }
    default: {
      if (action.startsWith('cc_audit:')) {
        if (!isAdmin(userId)) return send(denied('audit feed'));
        return send(buildAudit(Number(action.split(':')[1]) || 0));
      }
      if (action === 'cc_admin') return send(buildAdmin(userId));
      if (action === 'cc_sales_run') {
        try { await bot.sendChatAction(query.message.chat.id, 'typing'); } catch (_) { /* ignore */ }
        return send(buildSalesDemo());
      }
      if (action === 'cc_pipeline_run') {
        try { await bot.sendChatAction(query.message.chat.id, 'typing'); } catch (_) { /* ignore */ }
        return send(await buildPipelineDemo());
      }
      if (action === 'cc_live') {
        if (!isFounder(userId)) return send(denied('founder actions'));
        return send(modeConfirm('LIVE'));
      }
      if (action === 'cc_live_confirm') {
        if (!isFounder(userId)) return send(denied('founder actions'));
        return applyMode(query, bot, 'LIVE');
      }
      if (action === 'cc_live_cancel') return send(buildAdmin(userId));
      if (action === 'cc_dry') {
        if (!isAdmin(userId)) return send(denied('admin actions'));
        return send(modeConfirm('DRY'));
      }
      if (action === 'cc_dry_confirm') {
        if (!isAdmin(userId)) return send(denied('admin actions'));
        return applyMode(query, bot, 'DRY');
      }
      if (action === 'cc_dry_cancel') return send(buildAdmin(userId));
      if (action.startsWith('cc_set_lang:')) {
        const lang = action.split(':')[1];
        if (lang !== 'en' && lang !== 'ar') {
          return bot.answerCallbackQuery(query.id, { text: 'Unknown language' }).catch(() => {});
        }
        i18n.setLang(userId, lang);
        const ctx = await getCtx(userId);
        if (ctx) {
          await setWorkspaceLang(getStoreAdapter(), ctx.workspace.id, lang).catch(err =>
            console.error('[menu] setWorkspaceLang failed:', err.message));
        }
        return send(await buildSettings(userId));
      }
      return bot.answerCallbackQuery(query.id, { text: 'Unknown action' }).catch(() => {});
    }
  }
}

function denied(resource) {
  const panel = design.errorPanel(
    'Access denied',
    `You do not have permission to open ${resource}.`
  );
  return {
    text: panel.text,
    keyboard: design.keyboard([
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

module.exports = {
  buildHome,
  buildDashboard,
  buildWorkforce,
  buildPipeline,
  buildDeals,
  buildAudit,
  buildPricing,
  buildAdmin,
  buildAiGuide,
  buildSettings,
  handleCallback
};
