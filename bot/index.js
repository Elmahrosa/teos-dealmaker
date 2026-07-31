const TelegramBot = require('node-telegram-bot-api');
const { BOT_CONFIG } = require('./config');
const { handleMessage } = require('./handlers');
const { handleCallback } = require('./menu');
const audit = require('../utils/auditLogger');
const { getMode } = require('../config/mode');

const bot = new TelegramBot(BOT_CONFIG.token, { polling: true });

bot.on('message', async (msg) => {
  const start = Date.now();
  try {
    const result = handleMessage(msg);
    if (result && result.chatId && result.text) {
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
      await bot.sendMessage(msg.chat.id, '⚠️ An error occurred. Check server logs.');
    } catch (_) { /* ignore */ }
  }
});

bot.on('callback_query', (query) => handleCallback(query, bot));

console.log(`[TEOS DealMaker Bot] @${BOT_CONFIG.botName} polling (mode: ${getMode()})`);
