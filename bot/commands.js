const { getMode, setMode } = require('../config/mode');
const audit = require('../utils/auditLogger');
const { BOT_CONFIG } = require('./config');
const { WELCOME_TEXT, welcomeKeyboard } = require('./menu');

function isFounder(userId) {
  return BOT_CONFIG.founderId !== null && userId === BOT_CONFIG.founderId;
}

function isAdmin(userId) {
  return BOT_CONFIG.adminIds.includes(userId) || isFounder(userId);
}

function cmdStart(chatId) {
  return {
    chatId,
    text: WELCOME_TEXT,
    replyMarkup: welcomeKeyboard()
  };
}

function cmdHealth(chatId) {
  const mode = getMode();
  return {
    chatId,
    text: [
      `🩺 <b>Health Check</b>`,
      ``,
      `Mode: ${mode === 'LIVE' ? '🔴 LIVE' : '🟡 DRY'}`,
      `Bot: @${BOT_CONFIG.botName}`,
      `Timestamp: ${new Date().toISOString()}`
    ].join('\n')
  };
}

function cmdMode(chatId) {
  return { chatId, text: `Current mode: <b>${getMode()}</b>` };
}

function cmdLive(chatId, userId) {
  if (!isFounder(userId)) {
    audit.writeEntry('BOT_LIVE_DENIED', String(userId), 'denied', { reason: 'not founder' });
    return { chatId, text: `⛔ Founder only.` };
  }
  setMode('LIVE');
  audit.writeEntry('BOT_MODE', 'system', 'success', { mode: 'LIVE', by: userId });
  return { chatId, text: `🔴 Switched to <b>LIVE</b> mode.` };
}

function cmdDry(chatId, userId) {
  if (!isAdmin(userId)) {
    return { chatId, text: `⛔ Admin only.` };
  }
  setMode('DRY');
  audit.writeEntry('BOT_MODE', 'system', 'success', { mode: 'DRY', by: userId });
  return { chatId, text: `🟡 Switched to <b>DRY</b> mode.` };
}

function cmdAudit(chatId, userId, limit) {
  if (!isAdmin(userId)) {
    return { chatId, text: `⛔ Admin only.` };
  }
  const n = Number(limit);
  const size = isNaN(n) || n <= 0 ? 10 : n;
  const entries = audit.readVault();
  const recent = entries.slice(-size);
  if (recent.length === 0) {
    return { chatId, text: `No audit entries yet.` };
  }
  const lines = recent.map(e => {
    const t = (e.timestamp || '').slice(0, 19);
    return `<code>${t}</code> ${e.action} ${e.status} → ${e.target}`;
  });
  return { chatId, text: [`<b>Recent Audit Log</b>`, ...lines].join('\n') };
}

function cmdOutreach(chatId) {
  const { runOutreachCycle } = require('../agents/outreach');
  const result = runOutreachCycle({
    name: 'Telegram (Test)',
    email: 'test@example.com',
    template: 'intro'
  });
  return { chatId, text: `<b>Outreach test</b>: ${result.status}\nMessage ID: <code>${result.message_id}</code>` };
}

function cmdQualify(chatId) {
  const { processResponse } = require('../agents/qualification');
  const result = processResponse({
    id: 'tg_' + Date.now(),
    from: 'telegram@test.com',
    body: 'Sounds great! Let us schedule a demo.',
    industry: 'ai'
  });
  return { chatId, text: `<b>Qualify test</b>: ${result.routing.action} → ${result.routing.target_agent || 'archive'}` };
}

function cmdSales(chatId, userId, prompt) {
  if (!prompt) {
    return {
      chatId,
      text: [
        `Please provide the sales objection after the command.`,
        ``,
        `<i>Example:</i>`,
        `<code>/sales The price is too high</code>`
      ].join('\n')
    };
  }

  audit.writeEntry('BOT_COMMAND_SALES_RECEIVED', String(userId), 'in_progress', {
    command: '/sales',
    userId,
    text: prompt
  });

  try {
    const { runSalesFlow } = require('../agents/orchestrator');
    const result = runSalesFlow(prompt, userId);

    audit.writeEntry('BOT_COMMAND_SALES_RESPONSE', String(userId), 'success', {
      userId,
      objection: result.draft.objectionType,
      decision: result.review.decision,
      routed: result.routed ? result.routed.status : null
    });

    const lines = [
      `<b>Sales flow</b>: ${result.status}`,
      `Objection: ${result.draft.objectionType}`,
      `Gatekeeper: ${result.review.decision}`,
      `Draft: ${result.draft.draft}`
    ];
    if (result.routed) lines.push(`Route: ${result.routed.status}`);
    return { chatId, text: lines.join('\n') };
  } catch (error) {
    audit.writeEntry('BOT_COMMAND_SALES_ERROR', String(userId), 'error', {
      error: error.message,
      command: '/sales'
    });
    return {
      chatId,
      text: `An internal error occurred while processing your request. The incident has been logged.`
    };
  }
}

const COMMANDS = {
  '/start': cmdStart,
  '/help': cmdStart,
  '/status': cmdHealth,
  '/health': cmdHealth,
  '/mode': cmdMode,
  '/live': cmdLive,
  '/dry': cmdDry,
  '/audit': cmdAudit,
  '/outreach': cmdOutreach,
  '/qualify': cmdQualify,
  '/sales': cmdSales
};

module.exports = { COMMANDS, isFounder, isAdmin };
