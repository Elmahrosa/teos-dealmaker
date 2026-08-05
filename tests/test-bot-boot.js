// tests/test-bot-boot.js
// Boot smoke test: proves the bot command + callback pipeline works without a
// live Telegram connection, token or database. Drives the REAL
// handlers.handleMessage -> COMMANDS chain and the menu.handleCallback router
// against the in-process memory store, mirroring what bot/index.js wires up.
//
// This is the "bot boots and answers" check: if the modular bot/screens
// rewrite regressed the design from the v0.8.1 (last-night) build, this test
// fails before anything ships.

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.TELEGRAM_ADMIN_IDS = '7700001';
process.env.TEOS_FOUNDER_TELEGRAM_ID = '7700001';

const assert = require('assert');
const audit = require('../utils/auditLogger');
const { getStoreAdapter } = require('../bot/store');
const identity = require('../services/identity');
const learning = require('../services/learning');
const { handleMessage } = require('../bot/handlers');
const menu = require('../bot/menu');

(async () => {
  let n = 0;
  const check = (cond, msg) => { assert.ok(cond, msg); n += 1; };
  const equal = (a, b, msg) => { assert.strictEqual(a, b, msg); n += 1; };

  audit.clearVault();
  const adapter = getStoreAdapter();

  const FOUNDER = 7700001;
  const NEWCOMER = 8800001;

  // ---------------------------------------------------------------- founder
  const founder = await identity.ensureUser(adapter, FOUNDER, { display_name: 'Boot Founder' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: founder.id,
    companyName: 'Acme Boot',
    lang: 'en',
    plan: 'growth'
  });
  for (const rec of [
    { section: 'company', key: 'company_name', value: 'Acme Corp' },
    { section: 'company', key: 'problem', value: 'Complex B2B deals' },
    { section: 'company', key: 'products', value: 'Enterprise SaaS' },
    { section: 'company', key: 'ideal_customer', value: 'B2B SaaS founders' },
    { section: 'playbook', key: 'who_buys', value: 'CTOs and VPs of Sales' },
    { section: 'playbook', key: 'why_buy', value: 'Speed and accuracy' },
    { section: 'persona', key: 'goals', value: 'Grow ARR', context: 'CTO' },
    { section: 'persona', key: 'budget_authority', value: 'Yes', context: 'CTO' }
  ]) {
    await learning.record(adapter, ws.id, rec);
  }
  const prog = await learning.progress(adapter, ws.id);
  equal(prog.complete, true, 'founder learning foundation complete');

  // ---------------------------------------------------------- message chain
  const msg = (fromId, text) => ({
    chat: { id: fromId },
    from: { id: fromId, first_name: 'Boot' },
    text
  });

  // A brand-new user sees the onboarding prompt on /start.
  const onboardingRes = await handleMessage(msg(NEWCOMER, '/start'));
  check(Boolean(onboardingRes && onboardingRes.text), 'new user /start returns a prompt');
  check(/Set up your workspace/i.test(onboardingRes.text), 'new user prompt kicks off workspace setup');
  check(onboardingRes.replyMarkup && onboardingRes.replyMarkup.inline_keyboard, 'new user prompt has buttons');

  // An existing founder lands on the home dashboard.
  const home = await handleMessage(msg(FOUNDER, '/start'));
  equal(home.chatId, FOUNDER, 'founder /start is addressed to their chat');
  check(/MISSION CONTROL/i.test(home.text), 'founder home shows the MISSION CONTROL hero');
  check(home.replyMarkup && home.replyMarkup.inline_keyboard, 'founder home renders a keyboard');

  // Command sweep: every registered command answers with a screen.
  const COMMAND_LIST = [
    '/status', '/health', '/mode', '/workforce', '/pipeline', '/deals',
    '/pricing', '/memory', '/costs', '/providers', '/queue', '/briefing',
    '/intelligence', '/documents', '/integrations', '/learn', '/missions',
    '/mission', '/approvals', '/admin', '/audit'
  ];
  for (const cmd of COMMAND_LIST) {
    const res = await handleMessage(msg(FOUNDER, cmd));
    check(Boolean(res && res.chatId === FOUNDER && typeof res.text === 'string' && res.text.length > 0),
      `command ${cmd} answers with a screen`);
  }

  // Free text in DRY mode is acknowledged without crashing.
  const dryText = await handleMessage(msg(FOUNDER, 'follow up with Acme about the proposal'));
  check(Boolean(dryText && dryText.text), 'free text is acknowledged');

  // Unknown commands are rejected with a hint.
  const unknown = await handleMessage(msg(FOUNDER, '/totally_unknown_cmd'));
  check(/Unknown command/i.test(unknown.text), 'unknown command is rejected');

  // -------------------------------------------------------- callback chain
  let qid = 0;
  function makeBot() {
    const edits = [];
    const answers = [];
    return {
      edits,
      answers,
      async editMessageText(text, opts) { edits.push({ text, opts }); },
      async answerCallbackQuery(id, opts) { answers.push({ id, opts }); }
    };
  }
  function makeQuery(action, userId) {
    return {
      data: action,
      id: 'q' + (++qid),
      from: { id: userId },
      message: { chat: { id: userId }, message_id: 1 }
    };
  }
  const CALLBACK_MARKERS = [
    ['cc_home', 'MISSION CONTROL'],
    ['cc_workforce', 'Revenue Team'],
    ['cc_pipeline', 'Pipeline'],
    ['cc_deals', 'Deals'],
    ['cc_intelligence', 'Intelligence']
  ];
  for (const [action, marker] of CALLBACK_MARKERS) {
    const bot = makeBot();
    await menu.handleCallback(makeQuery(action, FOUNDER), bot);
    const last = bot.edits[bot.edits.length - 1];
    check(Boolean(last && last.text && last.text.includes(marker)),
      `callback ${action} renders a screen containing '${marker}'`);
    check(bot.answers.length === 1 && bot.answers[0].id.startsWith('q'), `callback ${action} answers the query`);
  }

  console.log(`\n\u2713 bot boot smoke (${n} assertions passed)`);
  console.log('  message chain: /start · onboarding · 21 commands · free text · unknown');
  console.log('  callback chain: 5 router screens render + answer');
  process.exit(0);
})().catch(err => {
  console.error('\u2717 bot boot smoke failed:', err);
  process.exit(1);
});
