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
  ok(/Quick Start/.test(first) && !/Setup complete|company name/i.test(first), 'first ordinary text before /start gets guidance, not a company name');
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
  ok(/I did not get that/.test(txt(await say(U, '/zzz'))), 'unknown command is explained with suggestions');
  ok(/اليوم/.test(txt(await say(U, 'مرحبا ماذا يمكنك أن تفعل'))), 'Arabic text gets an Arabic reply');
  for (const extra of [{ photo: [{}] }, { document: {} }, { voice: {} }, { sticker: {} }]) {
    ok(/I can only read text/.test(txt(await say(U, undefined, extra))), 'non-text attachment gets guidance');
  }
  ok(/I can only read text/.test(txt(await say(U, '   '))), 'blank text gets guidance');
  ok(/Welcome|TEOS/.test(txt(await say(U, '/help'))), '/help works');

  // --- navigation: stale or unknown buttons never dead-end ---
  const stale = await tap(U, 'cc_pricing');
  ok(/Platform|Welcome/.test(txt(stale)) || stale.some(x => /no longer available/.test(x.text)), 'removed pricing callback lands somewhere safe');
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
