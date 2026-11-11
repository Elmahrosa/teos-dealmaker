'use strict';
// bot/keyboardCleanup.js: removes a legacy Reply Keyboard once per chat, never
// blocks or breaks the real reply, never deletes anything but its own message.
const assert = require('assert');
const { clearLegacyKeyboard, _reset } = require('../bot/keyboardCleanup');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n += 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeBot({ failSend = 0, failDelete = false, sendDelay = 0 } = {}) {
  const bot = { sends: [], deletes: [], failSend, failDelete, id: 100 };
  bot.sendMessage = async (chatId, text, opts) => {
    if (sendDelay) await sleep(sendDelay);
    if (bot.failSend > 0) { bot.failSend -= 1; throw new Error('ETELEGRAM: 429 Too Many Requests'); }
    bot.id += 1;
    bot.sends.push({ chatId, text, opts, id: bot.id });
    return { message_id: bot.id };
  };
  bot.deleteMessage = async (chatId, id) => {
    bot.deletes.push([chatId, id]);
    if (bot.failDelete) throw new Error('400 message can not be deleted');
    return true;
  };
  return bot;
}

(async () => {
  // success: one remove_keyboard message, then only that message is deleted
  _reset();
  let bot = makeBot();
  eq(await clearLegacyKeyboard(bot, 1), true, 'first call cleans');
  eq(bot.sends.length, 1, 'exactly one message sent');
  eq(bot.sends[0].opts, { reply_markup: { remove_keyboard: true } }, 'sent with remove_keyboard');
  eq(bot.deletes, [[1, bot.sends[0].id]], 'only the cleanup message is deleted');

  // no repeat for the same chat; another chat is independent
  eq(await clearLegacyKeyboard(bot, 1), false, 'second call does nothing');
  eq(bot.sends.length, 1, 'cleanup is not repeated');
  eq(await clearLegacyKeyboard(bot, 2), true, 'another chat is cleaned');
  eq(bot.sends.map(s => s.chatId), [1, 2], 'one message per chat');

  // send failure: no throw, nothing deleted, chat NOT marked cleared, retried next time
  _reset();
  bot = makeBot({ failSend: 1 });
  eq(await clearLegacyKeyboard(bot, 3), false, 'send failure returns false without throwing');
  eq(bot.deletes, [], 'nothing is deleted when the send failed');
  eq(bot.sends.length, 0, 'no message was sent');
  eq(await clearLegacyKeyboard(bot, 3), true, 'the next update retries and succeeds');
  eq(bot.sends.length, 1, 'retry sent exactly one message');
  eq(await clearLegacyKeyboard(bot, 3), false, 'after a successful retry it is not repeated');
  eq(bot.sends.length, 1, 'still one message after success');

  // repeated failures keep retrying (never wrongly treated as cleared)
  _reset();
  bot = makeBot({ failSend: 3 });
  for (let i = 0; i < 3; i += 1) eq(await clearLegacyKeyboard(bot, 4), false, `failure ${i + 1} is not a success`);
  eq(await clearLegacyKeyboard(bot, 4), true, 'succeeds once Telegram recovers');

  // delete failure: cleanup still counts as done (the keyboard is gone), no throw, no repeat
  _reset();
  bot = makeBot({ failDelete: true });
  eq(await clearLegacyKeyboard(bot, 5), true, 'delete failure does not fail the cleanup');
  eq(await clearLegacyKeyboard(bot, 5), false, 'and the cleanup is not repeated');
  eq(bot.sends.length, 1, 'one message only after a delete failure');
  eq(bot.deletes.length, 1, 'delete attempted once');

  // bot without deleteMessage and odd send results are tolerated
  _reset();
  eq(await clearLegacyKeyboard({ sendMessage: async () => ({ message_id: 9 }) }, 6), true, 'no deleteMessage method tolerated');
  eq(await clearLegacyKeyboard({ sendMessage: async () => undefined, deleteMessage: async () => { throw new Error('must not be called'); } }, 7), true, 'no message id: nothing deleted');

  // concurrent updates for one chat share a single attempt
  _reset();
  bot = makeBot({ sendDelay: 40 });
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => clearLegacyKeyboard(bot, 8)));
  eq(bot.sends.length, 1, 'five concurrent updates send exactly one cleanup message');
  eq(results.filter(Boolean).length, 1, 'exactly one caller performed the cleanup');
  eq(bot.deletes.length, 1, 'exactly one delete');

  // concurrent updates while the first attempt FAILS: none counts as cleared; a later one retries
  _reset();
  bot = makeBot({ failSend: 1, sendDelay: 30 });
  const failed = await Promise.all([1, 2, 3].map(() => clearLegacyKeyboard(bot, 9)));
  eq(failed, [false, false, false], 'concurrent callers during a failed attempt do not report success');
  eq(bot.sends.length, 0, 'nothing sent during the failed attempt');
  eq(await clearLegacyKeyboard(bot, 9), true, 'a later update retries after the concurrent failure');
  eq(bot.sends.length, 1, 'exactly one message after recovery');

  // different chats in parallel do not block each other
  _reset();
  bot = makeBot({ sendDelay: 20 });
  await Promise.all([10, 11, 12].map(id => clearLegacyKeyboard(bot, id)));
  eq(bot.sends.map(s => s.chatId).sort(), [10, 11, 12], 'each parallel chat gets its own cleanup');

  ok(true, 'done');
  console.log(`PASS: keyboard cleanup (${n} assertions)`);
})().catch(err => { console.error(err); process.exit(1); });
