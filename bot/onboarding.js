const design = require('./design');
const i18n = require('./i18n');
const audit = require('../utils/auditLogger');
const { getStoreAdapter, isPersistent } = require('./store');
const identity = require('../services/identity');
const { buildHome } = require('./menu');

const state = new Map();

const PLANS = ['solo', 'growth', 'corporate'];

function isActive(userId) {
  return state.has(userId);
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

function nameScreen(userId) {
  return screen(userId, [
    `${design.EMOJI.ai} ${design.b(i18n.t(userId, 'onb_welcome'))}`,
    design.it(i18n.t(userId, 'onb_welcome_sub')),
    design.divider(),
    design.it(i18n.t(userId, 'onb_name')),
    !isPersistent() ? design.it(i18n.t(userId, 'onb_ephemeral')) : null,
    design.divider()
  ], design.keyboard([
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

function planScreen(userId) {
  return screen(userId, [
    `${design.EMOJI.ai} ${design.b(i18n.t(userId, 'onb_plan'))}`,
    design.it(i18n.t(userId, 'onb_plan_note')),
    design.divider()
  ], design.keyboard([
    [design.textButton(i18n.t(userId, 'plan_solo'), 'cc_onb_plan:solo')],
    [design.textButton(i18n.t(userId, 'plan_growth'), 'cc_onb_plan:growth')],
    [design.textButton(i18n.t(userId, 'plan_corporate'), 'cc_onb_plan:corporate')],
    [design.textButton(i18n.t(userId, 'onb_cancel'), 'cc_onb_cancel')]
  ]));
}

function start(userId) {
  state.set(userId, { step: 'name', name: null, lang: null, plan: null });
  return nameScreen(userId);
}

function prompt(userId) {
  const s = state.get(userId);
  if (!s) return start(userId);
  if (s.step === 'name') return nameScreen(userId);
  if (s.step === 'lang') return langScreen(userId);
  return planScreen(userId);
}

async function handleText(chatId, userId, text) {
  const s = state.get(userId);
  if (!s || s.step !== 'name') {
    return { chatId, text: design.it('Type /start to begin.') };
  }
  const name = String(text || '').trim();
  if (name.length < 2) {
    return { chatId, text: design.it('Please enter a company name (at least 2 characters).') };
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
    const user = await identity.ensureUser(adapter, userId);
    const workspace = await identity.onboardWorkspace(adapter, {
      ownerUserId: user.id,
      companyName: s.name,
      lang: s.lang,
      plan: s.plan
    });
    i18n.setLang(userId, s.lang);
    const agentCount = identity.AGENT_TYPES.length;
    reset(userId);
    audit.writeEntry('BOT_ONBOARDING_COMPLETED', String(userId), 'success', {
      workspaceId: workspace.id,
      plan: s.plan,
      lang: s.lang,
      agents: agentCount
    });
    const sc = screen(userId, [
      `${design.EMOJI.success} ${design.b(i18n.t(userId, 'onb_done'))}`,
      design.it(i18n.t(userId, 'onb_done_sub')),
      design.divider(),
      design.row('Workspace', s.name),
      design.row('Plan', i18n.t(userId, 'plan_' + s.plan)),
      design.row('Agents', String(agentCount)),
      design.row('Subscription', design.badge('warning')),
      design.divider(),
      design.it(i18n.t(userId, 'onb_plan_note')),
      !isPersistent() ? design.it(i18n.t(userId, 'onb_ephemeral')) : null,
      design.divider()
    ], design.keyboard([
      [design.textButton(i18n.t(userId, 'onb_open_cc'), 'cc_home')]
    ]));
    await bot.answerCallbackQuery(query.id, { text: i18n.t(userId, 'onb_done') }).catch(() => {});
    await bot.editMessageText(sc.text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: sc.keyboard
    });
    return true;
  } catch (err) {
    audit.writeEntry('BOT_ONBOARDING_ERROR', String(userId), 'error', { error: err.message });
    await bot.answerCallbackQuery(query.id, { text: 'Setup failed — retry' }).catch(() => {});
    await bot.editMessageText(design.errorPanel('Setup failed', String(err.message)).text, {
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
    await bot.answerCallbackQuery(query.id, { text: 'Setup cancelled' }).catch(() => {});
    await bot.editMessageText(sc.text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: sc.keyboard
    });
    return true;
  }

  if (action.startsWith('cc_onb_lang:')) {
    const s = state.get(userId);
    if (!s) return false;
    s.lang = action.split(':')[1];
    s.step = 'plan';
    const sc = planScreen(userId);
    await bot.answerCallbackQuery(query.id, { text: 'OK' }).catch(() => {});
    await bot.editMessageText(sc.text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: sc.keyboard
    });
    return true;
  }

  if (action.startsWith('cc_onb_plan:')) {
    const s = state.get(userId);
    if (!s) return false;
    const plan = action.split(':')[1];
    if (!PLANS.includes(plan)) return false;
    s.plan = plan;
    return complete(query, bot);
  }

  return false;
}

module.exports = { isActive, start, prompt, handleText, handleCallback, reset };
