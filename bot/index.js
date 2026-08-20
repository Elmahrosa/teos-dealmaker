const { TelegramBot } = require('node-telegram-bot-api');
const { BOT_CONFIG } = require('./config');
const { handleMessage } = require('./handlers');
const { handleCallback } = require('./menu');
const onboarding = require('./onboarding');
const audit = require('../utils/auditLogger');
const i18n = require('./i18n');
const { get, update } = require('../services/router/memory');
const { DISCLOSURES } = require('../services/transparency');
const { getMode } = require('../config/mode');
const { getStoreAdapter } = require('./store');
const { bootstrapFounder } = require('../services/founderSeed');
const { autoStartFounderMission } = require('../services/founderMission');
const notify = require('../services/notify');
const learningHook = require('../services/learningHook');

function escapeHtml(text) {
  return String(text).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

const bot = new TelegramBot(BOT_CONFIG.token, { polling: false });

let pollingActive = false;
let pollingRetryCount = 0;
const MAX_POLLING_RETRIES = 10;

function schedulePollingRetry(delayMs) {
  pollingRetryCount++;
  console.log(`[bot] Retry #${pollingRetryCount} in ${Math.round(delayMs / 1000)}s (max ${MAX_POLLING_RETRIES})`);
  setTimeout(async () => {
    try {
      await bot.startPolling({ restart: true });
      pollingActive = true;
      pollingRetryCount = 0;
      console.log('[bot] Polling restarted successfully after conflict resolution');
    } catch (retryErr) {
      if (String(retryErr.message).includes('409') && pollingRetryCount < MAX_POLLING_RETRIES) {
        const nextDelay = Math.min(delayMs * 2, 120000);
        console.error(`[bot] 409 persists after retry #${pollingRetryCount}, backing off to ${Math.round(nextDelay / 1000)}s`);
        schedulePollingRetry(nextDelay);
      } else {
        console.error('[bot] Retry failed:', retryErr.message);
      }
    }
  }, delayMs);
}

bot.on('polling_error', (err) => {
  const code = err.code || err.message || '';
  console.error(`[bot] polling_error: ${code}`);

  if (String(code).includes('409')) {
    console.error('[bot] 409 Conflict — another instance is polling. Initiating backoff retry.');
    bot.stopPolling({ cancel: true }).catch(() => {});
    pollingActive = false;
    schedulePollingRetry(10000);
  } else if (String(code).includes('502')) {
    console.error('[bot] 502 Bad Gateway — Telegram server issue, polling library will auto-retry');
  } else {
    console.error(`[bot] Unknown polling error: ${code}`);
  }
});

bot.on('message', async (msg) => {
  const start = Date.now();
  try {
    const result = await handleMessage(msg);
    if (result && result.chatId && result.text) {
      await bot.sendChatAction(result.chatId, 'typing').catch(() => {});
      const sendOpts = { parse_mode: 'HTML' };
      if (result.replyMarkup) sendOpts.reply_markup = result.replyMarkup;

      // AI disclosure logic
      const userId = String(result.chatId);
      const session = get(userId);
      if (result.__isAI && !session.disclosureShown) {
        const lang = i18n.getLang(userId);
        const disclosure = DISCLOSURES[lang] || DISCLOSURES.en;
        result.text = disclosure + '\n\n' + result.text;
        // update session
        update(userId, { disclosureShown: true });
      }

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
  learningHook.install(getStoreAdapter);
  if (String(process.env.BOT_POLLING) === '0') {
    console.log('[TEOS DealMaker Bot] polling disabled (BOT_POLLING=0) — running in passive mode');
    setInterval(() => {}, 1 << 30);
    return;
  }
  try {
    await bot.deleteWebhook({ drop_pending_updates: true });
    console.log('[bot] Cleared any stale webhook before polling');
  } catch (_) { /* no webhook to clear — fine */ }

  await bot.startPolling({ restart: true });
  pollingActive = true;
  console.log(`[TEOS DealMaker Bot] @${BOT_CONFIG.botName} polling (mode: ${getMode()})`);
}

bootstrap().catch((err) => {
  console.error('[bot] failed to start:', err.message);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`[bot] ${signal} received — stopping polling (active: ${pollingActive})`);
  pollingActive = false;
  bot.stopPolling({ cancel: true }).catch(() => {});
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
