'use strict';
// Older releases sent a persistent Reply Keyboard (Run sales / Status / Help /
// Fix error ...) that stays on the user's device until it is explicitly
// removed. Telegram cannot attach remove_keyboard to a message that also
// carries inline buttons, so the first time a chat talks to the bot it gets
// one tiny message that removes the keyboard, and that message is deleted
// right away. Old inline-button messages cannot be deleted by the bot; they
// are handled as stale callbacks instead (bot/menu.js).
//
// A chat is marked cleared ONLY after sendMessage succeeded. While a cleanup
// is running, concurrent updates for the same chat share that one attempt
// (inFlight) instead of sending a second message. A failed attempt leaves the
// chat uncleared so the next update retries.

const cleared = new Set();
const inFlight = new Map();
const MAX_TRACKED = 50000;

async function attempt(bot, chatId) {
  let sent;
  try {
    sent = await bot.sendMessage(chatId, '…', { reply_markup: { remove_keyboard: true } });
  } catch (_) {
    return false; // not cleared: retried on the next update
  }
  if (cleared.size >= MAX_TRACKED) cleared.clear();
  cleared.add(String(chatId));
  // Only the message sent just above is ever deleted; failure is irrelevant.
  if (sent && sent.message_id !== undefined && typeof bot.deleteMessage === 'function') {
    try { await bot.deleteMessage(chatId, sent.message_id); } catch (_) { /* ignore */ }
  }
  return true;
}

async function clearLegacyKeyboard(bot, chatId) {
  const key = String(chatId);
  if (cleared.has(key)) return false;
  if (inFlight.has(key)) { await inFlight.get(key); return false; }
  const p = attempt(bot, chatId).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

function _reset() { cleared.clear(); inFlight.clear(); }

module.exports = { clearLegacyKeyboard, _reset };
