const design = require('./design');
const i18n = require('./i18n');
const audit = require('../utils/auditLogger');
const { getStoreAdapter, isPersistent } = require('./store');
const identity = require('../services/identity');
const { buildHome } = require('./menu');
const { isNotModified } = require('./screens/lib');

const state = new Map();

// Entitlement default for new workspaces. Plan selection is not offered:
// activation is founder-approved, there is no checkout.
const DEFAULT_PLAN = 'solo';

async function safeEditMessageText(bot, query, text, extra) {
  try {
    await bot.editMessageText(text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      ...(extra || {})
    });
  } catch (err) {
    if (!isNotModified(err)) throw err;
  }
}

// A half-finished setup never lingers: it expires, so a later ordinary message
// is never mistaken for an answer to an old question.
const STATE_TTL_MS = 10 * 60 * 1000;

function isActive(userId) {
  const s = state.get(userId);
  if (!s) return false;
  if (Date.now() - s.at > STATE_TTL_MS) { state.delete(userId); return false; }
  return true;
}

function reset(userId) {
  state.delete(userId);
}

function screen(userId, blocks, keyboard) {
  return {
    text: design.compose(blocks),
    keyboard: keyboard || null
  };
}

// First screen of /start: nothing is asked in free text. The user taps Quick
// Start, chooses to enter a company name, or simply types a question.
function chooseScreen(userId) {
  return screen(userId, [
    `${design.EMOJI.ai} ${design.b(i18n.t(userId, 'onb_welcome'))}`,
    design.it(i18n.t(userId, 'onb_welcome_sub')),
    design.divider(),
    design.it(i18n.t(userId, 'onb_choose_sub')),
    !isPersistent() ? design.it(i18n.t(userId, 'onb_ephemeral')) : null,
    design.divider()
  ], design.keyboard([
    [design.textButton(i18n.t(userId, 'qs_btn'), 'cc_onb_quickstart')],
    [design.textButton(i18n.t(userId, 'onb_btn_company'), 'cc_onb_company')],
    [design.textButton(i18n.t(userId, 'onb_cancel'), 'cc_onb_cancel')]
  ]));
}

function nameScreen(userId) {
  return screen(userId, [
    `${design.EMOJI.ai} ${design.b(i18n.t(userId, 'onb_welcome'))}`,
    design.it(i18n.t(userId, 'onb_welcome_sub')),
    design.divider(),
    design.it(i18n.t(userId, 'onb_name')),
    !isPersistent() ? design.it(i18n.t(userId, 'onb_ephemeral')) : null,
    design.divider()
  ], design.keyboard([
    [design.textButton(i18n.t(userId, 'qs_btn'), 'cc_onb_quickstart')],
    [design.textButton(i18n.t(userId, 'onb_cancel'), 'cc_onb_cancel')]
  ]));
}

function langScreen(userId) {
  return screen(userId, [
    `${design.EMOJI.ai} ${design.b(i18n.t(userId, 'onb_lang'))}`,
    design.divider()
  ], design.keyboard([
    [design.textButton('English', 'cc_onb_lang:en')],
    [design.textButton('العربية', 'cc_onb_lang:ar')],
    [design.textButton(i18n.t(userId, 'onb_cancel'), 'cc_onb_cancel')]
  ]));
}

function start(userId) {
  state.set(userId, { step: 'choose', name: null, lang: null, at: Date.now() });
  return chooseScreen(userId);
}

function prompt(userId) {
  if (!isActive(userId)) return start(userId);
  const s = state.get(userId);
  if (s.step === 'choose') return chooseScreen(userId);
  if (s.step === 'name') return nameScreen(userId);
  return langScreen(userId);
}

// Returns a reply only when the user chose company setup and we are waiting for
// the name. Otherwise returns null so the message is handled as ordinary text.
async function handleText(chatId, userId, text) {
  if (!isActive(userId)) return null;
  const s = state.get(userId);
  if (s.step !== 'name') return null;
  s.at = Date.now();
  const name = String(text || '').trim();
  if (name.length < 2) {
    return { chatId, text: design.it(i18n.t(userId, 'onb_name_short')) };
  }
  s.name = name;
  s.step = 'lang';
  const sc = langScreen(userId);
  return { chatId, text: sc.text, replyMarkup: sc.keyboard };
}

async function complete(query, bot) {
  const userId = query.from ? query.from.id : null;
  const s = state.get(userId);
  const adapter = getStoreAdapter();
  try {
    const user = await identity.ensureUser(adapter, userId, {
      display_name: query.from ? query.from.first_name : null
    });
    const workspace = await identity.onboardWorkspace(adapter, {
      ownerUserId: user.id,
      companyName: s.name,
      lang: s.lang,
      plan: DEFAULT_PLAN
    });
    i18n.setLang(userId, s.lang);
    const agentCount = identity.AGENT_TYPES.length;
    reset(userId);
    audit.writeEntry('BOT_ONBOARDING_COMPLETED', String(userId), 'success', {
      workspaceId: workspace.id,
      plan: DEFAULT_PLAN,
      lang: s.lang,
      agents: agentCount
    });
    const sc = screen(userId, [
      `${design.EMOJI.success} ${design.b(i18n.t(userId, 'onb_done'))}`,
      design.it(i18n.t(userId, 'onb_done_sub')),
      design.divider(),
      design.row(i18n.t(userId, 'qs_workspace'), design.esc(s.name)),
      design.row(i18n.t(userId, 'qs_agents'), String(agentCount)),
      design.divider(),
      design.it(i18n.t(userId, 'qs_next')),
      !isPersistent() ? design.it(i18n.t(userId, 'onb_ephemeral')) : null,
      design.divider()
    ], design.keyboard([
      [design.textButton(i18n.t(userId, 'qs_start_mission'), 'cc_learn')],
      [design.textButton(i18n.t(userId, 'qs_skip'), 'cc_home')]
    ]));
    await bot.answerCallbackQuery(query.id, { text: i18n.t(userId, 'onb_done') }).catch(() => {});
    await safeEditMessageText(bot, query, sc.text, { reply_markup: sc.keyboard });
    return true;
  } catch (err) {
    audit.writeEntry('BOT_ONBOARDING_ERROR', String(userId), 'error', { error: err.message });
    await bot.answerCallbackQuery(query.id, { text: i18n.t(userId, 'onb_failed_retry') }).catch(() => {});
    await bot.editMessageText(design.errorPanel(i18n.t(userId, 'onb_failed'), i18n.t(userId, 'onb_failed_retry')).text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'HTML'
    }).catch(() => {});
    return true;
  }
}

async function quickStart(query, bot) {
  const userId = query.from ? query.from.id : null;
  const displayName = query.from ? query.from.first_name : null;
  const lang = i18n.getLang(userId) || 'en';
  const companyName = (displayName || 'My') + ' Workspace';

  await bot.answerCallbackQuery(query.id, { text: i18n.t(userId, 'qs_progress') }).catch(() => {});

  const adapter = getStoreAdapter();
  try {
    const user = await identity.ensureUser(adapter, userId, {
      display_name: displayName || null
    });
    const workspace = await identity.onboardWorkspace(adapter, {
      ownerUserId: user.id,
      companyName,
      lang,
      plan: 'solo'
    });
    i18n.setLang(userId, lang);
    const agentCount = identity.AGENT_TYPES.length;
    reset(userId);
    audit.writeEntry('BOT_QUICK_START', String(userId), 'success', {
      workspaceId: workspace.id,
      plan: 'solo',
      lang,
      agents: agentCount
    });
    const sc = screen(userId, [
      `${design.EMOJI.success} ${design.b(i18n.t(userId, 'qs_done'))}`,
      design.it(i18n.t(userId, 'qs_done_sub')),
      design.divider(),
      design.row(i18n.t(userId, 'qs_workspace'), design.esc(companyName)),
      design.row(i18n.t(userId, 'qs_agents'), String(agentCount)),
      design.divider(),
      design.it(i18n.t(userId, 'qs_next')),
      !isPersistent() ? design.it(i18n.t(userId, 'onb_ephemeral')) : null,
      design.divider()
    ], design.keyboard([
      [design.textButton(i18n.t(userId, 'qs_start_mission'), 'cc_learn')],
      [design.textButton(i18n.t(userId, 'qs_skip'), 'cc_home')]
    ]));
    await safeEditMessageText(bot, query, sc.text, { reply_markup: sc.keyboard });
    return true;
  } catch (err) {
    audit.writeEntry('BOT_QUICK_START_ERROR', String(userId), 'error', { error: err.message });
    await bot.answerCallbackQuery(query.id, { text: i18n.t(userId, 'onb_failed_retry') }).catch(() => {});
    await bot.editMessageText(design.errorPanel(i18n.t(userId, 'onb_failed'), i18n.t(userId, 'onb_failed_retry')).text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'HTML'
    }).catch(() => {});
    return true;
  }
}

async function handleCallback(query, bot) {
  const userId = query.from ? query.from.id : null;
  const action = query.data || '';

  if (action === 'cc_onb_cancel') {
    reset(userId);
    const sc = await buildHome(userId);
    await bot.answerCallbackQuery(query.id, { text: i18n.t(userId, 'onb_cancelled') }).catch(() => {});
    await safeEditMessageText(bot, query, sc.text, { reply_markup: sc.keyboard });
    return true;
  }

  if (action === 'cc_onb_quickstart') {
    return quickStart(query, bot);
  }

  if (action === 'cc_onb_company') {
    if (!isActive(userId)) start(userId);
    const s = state.get(userId);
    s.step = 'name';
    s.at = Date.now();
    const sc = nameScreen(userId);
    await bot.answerCallbackQuery(query.id).catch(() => {});
    await safeEditMessageText(bot, query, sc.text, { reply_markup: sc.keyboard });
    return true;
  }

  if (action.startsWith('cc_onb_lang:')) {
    const s = state.get(userId);
    if (!s) return false;
    const lang = action.split(':')[1];
    if (!['en', 'ar'].includes(lang)) return false;
    s.lang = lang;
    s.at = Date.now();
    return complete(query, bot);
  }

  return false;
}

module.exports = { isActive, start, prompt, handleText, handleCallback, reset };
