const { TelegramBot } = require('node-telegram-bot-api');
const { BOT_CONFIG } = require('./config');
const { handleMessage } = require('./handlers');
const { handleCallback } = require('./menu');
const onboarding = require('./onboarding');
const audit = require('../utils/auditLogger');
const { getMode } = require('../config/mode');

function escapeHtml(text) {
  return String(text).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

const bot = new TelegramBot(BOT_CONFIG.token, { polling: true });

bot.on('message', async (msg) => {
  const start = Date.now();
  try {
    const result = await handleMessage(msg);
    if (result && result.chatId && result.text) {
      await bot.sendChatAction(result.chatId, 'typing').catch(() => {});
      const sendOpts = { parse_mode: 'HTML' };
      if (result.replyMarkup) sendOpts.reply_markup = result.replyMarkup;
      await bot.sendMessage(result.chatId, result.text, sendOpts);
      audit.writeEntry('BOT_SEND', String(msg.chat.id), 'success', {
        durationMs: Date.now() - start,
        mode: getMode()
      });
    }
  } catch (err) {
    console.error('[bot] handler error:', err.message);
    try {
      await bot.sendMessage(msg.chat.id, '🔴 <b>Request failed</b>\n\nCheck server logs.');
    } catch (_) { /* ignore */ }
  }
});

bot.on('callback_query', async (query) => {
  try {
    const userId = query.from ? query.from.id : null;
    if (userId && onboarding.isActive(userId)) {
      const handled = await onboarding.handleCallback(query, bot);
      if (handled) return;
    }
    await handleCallback(query, bot);
  } catch (err) {
    console.error('[bot] callback error:', err.message);
    try {
      await bot.editMessageText('🔴 <b>Action failed</b>\n\n' + escapeHtml(err.message), {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: 'HTML'
      });
    } catch (_) { /* ignore */ }
  }
});

console.log(`[TEOS DealMaker Bot] @${BOT_CONFIG.botName} polling (mode: ${getMode()})`);
