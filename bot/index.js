const { TelegramBot } = require('node-telegram-bot-api');
const { BOT_CONFIG } = require('./config');
const { handleMessage } = require('./handlers');
const { handleCallback } = require('./menu');
const onboarding = require('./onboarding');
const audit = require('../utils/auditLogger');
const { getMode } = require('../config/mode');
const { getStoreAdapter } = require('./store');
const { bootstrapFounder } = require('../services/founderSeed');
const { autoStartFounderMission } = require('../services/founderMission');
const notify = require('../services/notify');

function escapeHtml(text) {
  return String(text).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

const bot = new TelegramBot(BOT_CONFIG.token, { polling: false });

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

async function bootstrap() {
  if (!BOT_CONFIG.token) {
    console.error('[bot] TELEGRAM_BOT_TOKEN is not set. Create a bot via @BotFather and set TELEGRAM_BOT_TOKEN in the environment.');
    process.exit(1);
  }
  try {
    const me = await bot.getMe();
    console.log(`[bot] Telegram bot @${me.username} verified (id ${me.id})`);
  } catch (err) {
    console.error(`[bot] TELEGRAM_BOT_TOKEN was rejected by Telegram (${err.message}).`);
    console.error('[bot] Generate a new token via @BotFather and update TELEGRAM_BOT_TOKEN, then restart.');
    process.exit(1);
  }
  try {
    const seeded = await bootstrapFounder(getStoreAdapter());
    if (seeded && seeded.seeded && seeded.workspace) {
      console.log(`[bot] founder workspace seeded (workspace #${seeded.workspace.id}, mission #${seeded.mission && seeded.mission.plan ? seeded.mission.plan.id : '—'})`);
      try {
        const auto = await autoStartFounderMission(getStoreAdapter(), seeded.workspace.id);
        if (auto.started) {
          console.log(`[bot] Customer #0 mission auto-started: ${auto.status} (${auto.steps} steps, ${auto.pendingApprovals} pending approvals)`);
        } else {
          console.log(`[bot] Customer #0 mission not auto-started: ${auto.reason}`);
        }
      } catch (autoErr) {
        console.error('[bot] Customer #0 auto-start failed:', autoErr && autoErr.stack ? autoErr.stack : autoErr);
      }
    }
  } catch (err) {
    console.error('[bot] founder seed failed:', err && err.stack ? err.stack : err);
  }
  notify.install();
  await bot.startPolling();
  console.log(`[TEOS DealMaker Bot] @${BOT_CONFIG.botName} polling (mode: ${getMode()})`);
}

bootstrap().catch((err) => {
  console.error('[bot] failed to start:', err.message);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`[bot] ${signal} received — stopping polling`);
  bot.stopPolling().catch(() => {});
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
