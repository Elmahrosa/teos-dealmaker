'use strict';
// Real production bot entry point (bot/index.js) driven with a MOCKED Telegram
// client. This proves our wiring (startup, handlers, error paths, shutdown). It
// does NOT prove connectivity to the real Telegram API; that needs a real token
// and is reported separately.
process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'mock-token-not-real';
process.env.TELEGRAM_ADMIN_IDS = '9100001';
process.env.TEOS_FOUNDER_TELEGRAM_ID = '9100001';
delete process.env.BOT_POLLING;
delete process.env.DATABASE_URL;

const assert = require('assert');
const { EventEmitter } = require('events');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n += 1; };

const calls = [];
const sent = [];
let instances = 0;
let failGetMe = false;
let lastBot = null;
class FakeBot extends EventEmitter {
  constructor(token, opts) { super(); lastBot = this; instances += 1; this.token = token; this.opts = opts; calls.push(['ctor', opts]); }
  async getMe() { calls.push(['getMe']); if (failGetMe) throw new Error('401 Unauthorized'); return { id: 1, username: 'mock_bot' }; }
  async deleteWebhook() { calls.push(['deleteWebhook']); return true; }
  async startPolling() { calls.push(['startPolling']); return true; }
  async stopPolling() { calls.push(['stopPolling']); return true; }
  async sendChatAction() { return true; }
  async sendMessage(chatId, text, opts) { sent.push({ chatId, text: String(text), opts }); return { message_id: sent.length }; }
  async editMessageText(text, opts) { sent.push({ chatId: opts && opts.chat_id, text: String(text), opts, edited: true }); return true; }
  async answerCallbackQuery(id, opts) { sent.push({ chatId: null, text: 'TOAST:' + String((opts && opts.text) || ''), toast: true }); return true; }
  async deleteMessage() { return true; }
}
const tgPath = require.resolve('node-telegram-bot-api');
require.cache[tgPath] = { id: tgPath, filename: tgPath, loaded: true, exports: { TelegramBot: FakeBot } };

const exits = [];
const realExit = process.exit;
process.exit = code => { exits.push(code); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const L = { l: console.log, e: console.error, w: console.warn };
const unquiet = () => { console.log = L.l; console.error = L.e; console.warn = L.w; };
const quiet = () => { console.log = console.error = console.warn = () => {}; return unquiet; };

(async () => {
  const restore = quiet();
  require('../bot/index.js');
  await sleep(300);
  restore();

  ok(instances === 1, 'exactly one bot instance');
  ok(calls.some(c => c[0] === 'getMe'), 'token verified via getMe at startup');
  eq(calls.filter(c => c[0] === 'startPolling').length, 1, 'exactly one polling loop');
  ok(calls.findIndex(c => c[0] === 'deleteWebhook') < calls.findIndex(c => c[0] === 'startPolling'), 'webhook cleared before polling (never both modes)');
  eq(calls[0][1].polling, false, 'constructed with polling:false then started once explicitly');
  eq(exits.length, 0, 'no premature exit');
  const bot = lastBot;
  const say = async (id, text, extra = {}) => { const from = sent.length; bot.emit('message', { chat: { id }, from: { id }, text, ...extra }); await sleep(120); return sent.slice(from); };
  const tap = async (id, data) => { const from = sent.length; bot.emit('callback_query', { id: 'cb' + Math.random(), from: { id }, data, message: { chat: { id }, message_id: 7 } }); await sleep(120); return sent.slice(from); };
  const R = quiet();
  const U = 9200001; // ordinary user
  const F = 9100001; // founder
  const adapter = require('../bot/store').getStoreAdapter();
  const txt = r => r.filter(x => !x.toast).map(x => x.text).join('\n');
  const dealsOf = async () => (await adapter.find('deals', {}));

  // --- onboarding: one tap, no forced questions ---
  ok(/Set up your workspace/.test(txt(await say(U, '/start'))), '/start shows setup');
  ok(/Quick Start complete/.test(txt(await tap(U, 'cc_onb_quickstart'))), 'one-tap quick start provisions a workspace');

  // --- first-message onboarding: ordinary text is never taken as a company name ---
  const N1 = 9200101, N2 = 9200102, N3 = 9200103, N4 = 9200104;
  const identity = require('../services/identity');
  const ws = async (id) => { const u = await identity.getUserByTelegram(adapter, id); return u ? identity.getWorkspaceForUser(adapter, u.id) : null; };
  const first = txt(await say(N1, 'Acme Trading'));
  ok(/Quick Start/.test(first) && !/Setup complete/i.test(first), 'first ordinary text before /start gets guidance, not a company name');
  ok(!(await ws(N1)), 'first ordinary text creates no workspace');
  const st = await say(N1, '/start');
  ok(/Quick Start/.test(JSON.stringify(st)) && /Enter my company name/.test(JSON.stringify(st)), '/start offers Quick Start and an explicit company-name choice');
  const q = txt(await say(N1, 'what can you do?'));
  ok(q.length > 0 && !(await ws(N1)), 'ordinary question during setup choice is answered and takes no name');
  await tap(N1, 'cc_onb_company');
  eq(await ws(N1), null, 'choosing company setup creates nothing until a name and language are given');
  // abandoned: a command during the name step clears the state
  await say(N2, '/start'); await tap(N2, 'cc_onb_company'); await say(N2, '/help');
  ok(!(await ws(N2)) && !/language|اللغة/i.test(txt(await say(N2, 'Globex'))), 'a command mid-setup clears state: next text is not a name');
  // navigation mid-setup clears state
  await say(N3, '/start'); await tap(N3, 'cc_onb_company'); await tap(N3, 'cc_home');
  await say(N3, 'Initech');
  ok(!(await ws(N3)), 'navigation mid-setup clears state: next text is not a name');
  // explicit setup: name then language completes with that name
  await say(N4, '/start'); await tap(N4, 'cc_onb_company');
  await say(N4, 'Hooli Egypt');
  await tap(N4, 'cc_onb_lang:en');
  const w4 = await ws(N4);
  ok(w4 && /Hooli Egypt/.test(w4.name || w4.company_name || JSON.stringify(w4)), 'explicit setup uses the typed company name');
  // returning user
  ok(!/Set up your workspace/.test(txt(await say(N4, '/start'))), 'returning user /start goes home, not setup');
  ok(/How can I help/.test(txt(await say(N4, 'hello'))), 'returning user ordinary text answered');

  // --- ordinary text, unknown commands, Arabic, attachments ---
  ok(/How can I help/.test(txt(await say(U, 'hello'))), 'ordinary English text gets a useful reply');
  ok(/not sure what you mean/.test(txt(await say(U, '/zzz'))), 'unknown command is explained with suggestions');
  ok(/اليوم/.test(txt(await say(U, 'مرحبا ماذا يمكنك أن تفعل'))), 'Arabic text gets an Arabic reply');
  for (const extra of [{ photo: [{}] }, { document: {} }, { voice: {} }, { sticker: {} }]) {
    ok(/I can only read text/.test(txt(await say(U, undefined, extra))), 'non-text attachment gets guidance');
  }
  ok(/I can only read text/.test(txt(await say(U, '   '))), 'blank text gets guidance');
  ok(/sales pipeline/.test(txt(await say(U, '/help'))), '/help works');

  // --- navigation: stale or unknown buttons never dead-end ---
  const stale = await tap(U, 'cc_pricing');
  ok(/TEOS DEALMAKER|Welcome/.test(txt(stale)) || stale.some(x => /no longer available/.test(x.text)), 'removed pricing callback lands somewhere safe');
  ok((await tap(U, 'cc_nonexistent')).some(x => /no longer available/.test(x.text)), 'unknown callback explained');

  // --- founder-only enforcement, server-side, for commands and callbacks ---
  for (const c of ['/sales', '/outreach', '/qualify']) ok(/Founder only/.test(txt(await say(U, c))), c + ' denied for ordinary user');
  ok(/Access denied/.test(txt(await tap(U, 'cc_sales_run'))), 'founder callback denied for ordinary user');
  ok(/Sales Flow/.test(txt(await say(F, '/sales'))), 'founder can open /sales');

  // --- deal creation: DRY persists nothing, LIVE creates an open deal ---
  const { getMode, setMode } = require('../config/mode');
  eq(getMode(), 'DRY', 'default mode is DRY');
  const run = async (inputs) => { await tap(U, 'cc_pipeline_run'); let last = []; for (const t of inputs) last = await say(U, t); return last; };
  const before = (await dealsOf()).length;
  const dry = await run(['1', 'Domain for fintech', '١٢٠٠', 'USD', '١٠٠٠', '٥٠٠', '/skip']);
  ok(dry.length > 0 && /not|DRY|preview|simulat/i.test(txt(dry)), 'DRY run replies and says nothing was sent');
  eq((await dealsOf()).length, before, 'DRY persisted no deal');
  setMode('LIVE');
  const live = await run(['1', 'Domain for fintech', '1200', 'USD', '1000', '500', '/skip']);
  ok(live.length > 0, 'LIVE run replies');
  const after = await dealsOf();
  eq(after.length, before + 1, 'LIVE created exactly one deal');
  const made = after.find(d => d.company_name !== 'Elmahrosa International') || after[after.length - 1];
  ok(!['won', 'closed'].includes(made.stage) && made.status === 'open', 'LIVE deal is open, never won/closed: ' + made.stage + '/' + made.status);
  ok(!/delivered|sent to the customer|email sent/i.test(txt(live)), 'no delivery claim without a transport');
  setMode('DRY');
  const c0 = after.find(d => d.company_name === 'Elmahrosa International');
  if (c0) ok(c0.stage === 'incoming' && c0.status === 'open', 'Customer #0 still incoming/open');

  // --- state hygiene: navigation clears half-finished input ---
  await tap(U, 'cc_pipeline_run'); await say(U, '1');
  await tap(U, 'cc_home');
  ok(/How can I help/.test(txt(await say(U, 'hello'))), 'a menu tap clears a half-finished deal form');

  // --- database unavailable: explained, internals not leaked, nothing claimed ---
  // --- UX regression after the PR #50 recording (conversation, keyboards, founder split) ---
  const replyOf = r => r.filter(x => !x.toast && x.opts && x.opts.reply_markup).map(x => x.opts.reply_markup);
  const hasReplyKeyboard = r => replyOf(r).some(m => Array.isArray(m.keyboard));
  const inline = r => replyOf(r).flatMap(m => (m.inline_keyboard || []).flat().map(b => b.callback_data));
  const FOUNDER_ONLY = ['cc_missions', 'cc_approvals', 'cc_mission1', 'cc_mission_goal', 'cc_fd_billing', 'cc_fd_revenue', 'cc_fd_debug', 'cc_founder'];

  for (const q of ['WHAT IS DEALMAKER', 'what is dealmaker?', 'What is TEOS DealMaker', 'who are you']) {
    const r = await say(U, q);
    ok(/AI sales assistant/.test(txt(r)) && !/did not get that|not sure what you mean/.test(txt(r)), `"${q}" is explained`);
    ok(!hasReplyKeyboard(r), `"${q}" sends no persistent reply keyboard`);
    ok(inline(r).includes('cc_pipeline_run') && inline(r).includes('cc_home'), `"${q}" routes to Run Pipeline and Home`);
  }
  for (const q of ['I need help', 'help me please', 'Can you help me']) {
    const r = await say(U, q);
    ok(/I can help you run a sales pipeline/.test(txt(r)), `"${q}" gets the help answer`);
    ok(!/mission|approval|billing|revenue center/i.test(txt(r)), `"${q}" does not push missions or approvals on an ordinary user`);
  }
  ok(/مساعد مبيعات/.test(txt(await say(U, 'ما هو DealMaker'))), 'Arabic "what is DealMaker" is explained in Arabic');
  ok(/يمكنني مساعدتك/.test(txt(await say(U, 'أحتاج مساعدة'))), 'Arabic "I need help" gets Arabic help');
  const gib = await say(U, 'blorp zxq');
  ok(/not sure what you mean/.test(txt(gib)) && !/I did not get that yet/.test(txt(gib)) && inline(gib).includes('cc_pipeline_run'), 'unknown text gets a helpful answer with buttons');
  ok(!hasReplyKeyboard(gib), 'unknown text sends no reply keyboard');
  const helpCmd = await say(U, '/help');
  ok(/I can help you run a sales pipeline/.test(txt(helpCmd)) && !hasReplyKeyboard(helpCmd), '/help is the help answer, not the old panel');

  // A user without a workspace is answered and offered Quick Start; nothing is created.
  const NW = 9200301;
  const nw = await say(NW, 'WHAT IS DEALMAKER');
  ok(/AI sales assistant/.test(txt(nw)) && inline(nw).includes('cc_onb_quickstart'), 'no-workspace user gets the answer plus Quick Start');
  ok((await ws(NW)) === null, 'asking a question creates no workspace');

  // Old Reply Keyboard is removed once per chat, before the first reply.
  const NK = 9200302;
  const k1 = await say(NK, 'hello');
  ok(k1.some(x => x.opts && x.opts.reply_markup && x.opts.reply_markup.remove_keyboard === true), 'first reply to a chat removes the legacy Reply Keyboard');
  const k2 = await say(NK, 'hello');
  ok(!k2.some(x => x.opts && x.opts.reply_markup && x.opts.reply_markup.remove_keyboard), 'the cleanup is not repeated');
  const kt = await tap(9200303, 'cc_home');
  ok(kt.some(x => x.opts && x.opts.reply_markup && x.opts.reply_markup.remove_keyboard === true), 'a stale inline tap also clears the legacy Reply Keyboard');

  // /start: ordinary user vs Founder.
  const us = await say(U, '/start');
  ok(/TEOS DEALMAKER/.test(txt(us)) && !/Mission Center|Revenue Center|Billing|Approvals/.test(txt(us)), 'ordinary /start shows the simple home');
  ok(!hasReplyKeyboard(us), 'ordinary /start sends no reply keyboard');
  for (const f of FOUNDER_ONLY) ok(!inline(us).includes(f), `ordinary home does not show ${f}`);
  const fs2 = await say(F, '/start');
  ok(/TEOS DEALMAKER/.test(txt(fs2)) && !/Revenue Center|Billing/.test(txt(fs2)), 'Founder /start shows the simple home, not the old panel');
  ok(inline(fs2).includes('cc_founder') && !inline(fs2).includes('cc_fd_billing') && !inline(fs2).includes('cc_missions'), 'Founder home only offers the Founder Console entry');
  ok(inline(await tap(F, 'cc_founder')).includes('cc_fd_billing'), 'Founder Console opens the full Founder panel for the Founder');
  ok(/Mission/i.test(txt(await tap(F, 'cc_missions'))) && !/Access denied/.test(txt(await tap(F, 'cc_missions'))), 'Founder keeps access to Missions');
  ok(!/Access denied/.test(txt(await tap(F, 'cc_approvals'))), 'Founder keeps access to Approvals');

  // Founder-only functions stay protected.
  for (const f of ['cc_founder', 'cc_fd_billing', 'cc_fd_revenue', 'cc_fd_debug', 'cc_mission_create', 'cc_sales_run', 'cc_missions', 'cc_approvals']) {
    ok(/Access denied/.test(txt(await tap(U, f))), `ordinary user is denied ${f}`);
  }
  // Every mission and approval callback class is checked inside the handler,
  // not just hidden: direct callbacks from an ordinary user are denied and no
  // runtime operation runs.
  const runtimeMod = require('../services/workforce/runtime');
  const spied = ['resume', 'pause', 'approveAndResume'];
  const origRt = {}; const rtCalls = [];
  for (const k of spied) { origRt[k] = runtimeMod[k]; runtimeMod[k] = async (...a) => { rtCalls.push(k); return origRt[k](...a); }; }
  const missionClasses = ['cc_mission1', 'cc_mission2', 'cc_mission_market', 'cc_mission_goal', 'cc_mission:1', 'cc_mission_run:1',
    'cc_mission_pause:1', 'cc_mission_resume:1', 'cc_mission_report:1', 'cc_mission_kpis:1', 'cc_appr:1:approve', 'cc_appr:1:reject'];
  for (const f of missionClasses) {
    ok(/Access denied/.test(txt(await tap(U, f))), `ordinary user is denied ${f} sent directly`);
  }
  eq(rtCalls.length, 0, 'no resume, pause or approval ran for the ordinary user');
  // Denied before any workspace/context read: the store adapter is never touched.
  // A Founder control call proves the spy really observes reads.
  {
    const storeReads = []; const touched = [];
    for (const k of Object.keys(adapter)) {
      if (typeof adapter[k] !== 'function') continue;
      const orig = adapter[k]; touched.push([k, orig]);
      adapter[k] = function (...a) { storeReads.push(k); return orig.apply(this, a); };
    }
    for (const f of missionClasses.concat(['cc_missions', 'cc_approvals', 'cc_mission_form_cancel'])) await tap(U, f);
    const deniedReads = storeReads.length;
    await tap(F, 'cc_missions');
    const founderReads = storeReads.length - deniedReads;
    for (const [k, orig] of touched) adapter[k] = orig;
    eq(deniedReads, 0, 'denied mission and approval callbacks perform no store reads: ' + storeReads.slice(0, deniedReads).join(','));
    ok(founderReads > 0, 'control: the same spy sees store reads for a Founder callback');
  }
  for (const f of missionClasses) {
    ok(!/Access denied/.test(txt(await tap(F, f))), `Founder is not denied ${f}`);
  }
  for (const k of spied) runtimeMod[k] = origRt[k];
  // cc_mission_form_cancel: own form only, founder only, no mission runtime work.
  const missionStateMod = require('../bot/missionState');
  const rtSpy2 = []; const origRt2 = {};
  for (const k of ['resume', 'pause', 'approveAndResume', 'runGoal']) {
    if (typeof runtimeMod[k] !== 'function') continue;
    origRt2[k] = runtimeMod[k]; runtimeMod[k] = async (...a) => { rtSpy2.push(k); return origRt2[k](...a); };
  }
  missionStateMod.begin(F, { mode: 'mission_create', step: 'name', mission: {} });
  missionStateMod.begin(U, { mode: 'mission_create', step: 'name', mission: {} });
  const ordinaryCancel = await tap(U, 'cc_mission_form_cancel');
  ok(/Access denied/.test(txt(ordinaryCancel)), 'ordinary user cannot use cc_mission_form_cancel and sees Access denied');
  ok(!/Mission Center/i.test(txt(ordinaryCancel)), 'ordinary user is not shown the Mission Center');
  ok(missionStateMod.pending(F), "an ordinary user cancelling does not clear the Founder's form");
  ok(missionStateMod.pending(U), 'a denied cancel leaves the ordinary users own state untouched (nothing ran)');
  missionStateMod.clear(U);
  const founderCancel = await tap(F, 'cc_mission_form_cancel');
  ok(!/Access denied/.test(txt(founderCancel)), 'Founder can cancel their own form');
  ok(!missionStateMod.pending(F), "Founder's own form is cleared by cancel");
  missionStateMod.begin(U, { mode: 'mission_create', step: 'name', mission: {} });
  await tap(F, 'cc_mission_form_cancel');
  ok(missionStateMod.pending(U), "Founder cancelling does not clear another user's form");
  missionStateMod.clear(U);
  eq(rtSpy2.length, 0, 'cancel never invokes mission runtime operations');
  for (const k of Object.keys(origRt2)) runtimeMod[k] = origRt2[k];
  ok(/founder/i.test(txt(await say(U, 'fix error'))), 'ordinary user cannot run founder diagnostics by text');
  for (const c of ['/sales', '/outreach', '/qualify', '/mode']) {
    ok(!/Founder Console/.test(txt(await say(U, c))) && /[Ff]ounder|denied|not available/.test(txt(await say(U, c))), `${c} is not usable by an ordinary user`);
  }

  // Stale buttons from old messages are explained in place and lead Home.
  const staleTap = await tap(U, 'cc_launch_campaign');
  ok(/no longer available/.test(txt(staleTap)) && inline(staleTap).includes('cc_home'), 'stale button is replaced by a notice with a Home button');
  ok(/TEOS DEALMAKER/.test(txt(await tap(U, 'cc_pricing'))), 'retired cc_pricing button lands on Home');

  const real = { find: adapter.find, findOne: adapter.findOne, insert: adapter.insert, update: adapter.update };
  const boom = () => Promise.reject(new Error('db_down postgres://user:SECRET@host/db'));
  Object.assign(adapter, { find: boom, findOne: boom, insert: boom, update: boom });

  const dbMsgs = [...await say(U, 'run sales'), ...await say(U, 'status'), ...await tap(U, 'cc_home'), ...await say(U + 5, '/start')];
  Object.assign(adapter, real);
  const dbText = txt(dbMsgs);
  ok(dbMsgs.length > 0, 'DB outage still produces replies');
  if (/SECRET/.test(dbText)) { unquiet(); console.log(dbMsgs.filter(m => /SECRET/.test(m.text)).map(m => m.text.slice(0, 200))); }
  ok(!/SECRET|postgres:\/\//.test(dbText), 'no connection details leaked to the user');
  ok(!/Quick Start complete|delivered|created/i.test(dbText), 'DB outage never reads as success');

  // --- Telegram API failure on send is survived ---
  const realSend = bot.sendMessage;
  bot.sendMessage = async () => { throw new Error('429 Too Many Requests'); };
  const sentBefore = sent.length;
  bot.emit('message', { chat: { id: U }, from: { id: U }, text: 'hello' });
  await sleep(150);
  bot.sendMessage = realSend;
  eq(exits.length, 0, 'a Telegram send failure does not kill the process');
  void sentBefore;
  bot.emit('error', new Error('network down')); bot.emit('polling_error', { code: 'EFATAL' });
  await sleep(20);
  eq(exits.length, 0, 'request and polling errors are survived');

  // --- shutdown ---
  process.emit('SIGTERM');
  await sleep(100);
  ok(calls.some(c => c[0] === 'stopPolling'), 'SIGTERM stops polling');
  eq(exits[0], 0, 'clean exit code on shutdown');
  R();
  console.log('PASS: bot entry point startup (' + n + ' assertions)');
  process.exit = realExit; process.exit(0);
})().catch(err => { unquiet(); process.exit = realExit; console.error(err); process.exit(1); });
