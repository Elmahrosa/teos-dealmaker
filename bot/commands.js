const { getMode, setMode } = require('../config/mode');
const audit = require('../utils/auditLogger');
const { BOT_CONFIG } = require('./config');

function isFounder(userId) {
  return BOT_CONFIG.founderId !== null && userId === BOT_CONFIG.founderId;
}

function isAdmin(userId) {
  return BOT_CONFIG.adminIds.includes(userId) || isFounder(userId);
}

function cmdStart(chatId) {
  const mode = getMode();
  return {
    chatId,
    text: [
      `<b>TEOS DealMaker Bot</b>`,
      ``,
      `Status: ${mode === 'LIVE' ? '🔴 LIVE' : '🟡 DRY RUN'}`,
      ``,
      `Commands:`,
      `/status — system status`,
      `/mode — show current mode`,
      `/live — switch to LIVE (founder only)`,
      `/dry — switch to DRY`,
      `/audit — recent audit log (admin)`,
      `/outreach — run outreach cycle test`,
      `/qualify — run qualification test`,
      `/sales — run sales test`,
      `/sales &lt;prompt&gt; — end-to-end sales flow (draft → gatekeeper → route)`
    ].join('\n')
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
  if (prompt) {
    const { runSalesFlow } = require('../agents/orchestrator');
    const result = runSalesFlow(prompt, userId);
    const lines = [
      `<b>Sales flow</b>: ${result.status}`,
      `Objection: ${result.draft.objectionType}`,
      `Gatekeeper: ${result.review.decision}`,
      `Draft: ${result.draft.draft}`
    ];
    if (result.routed) lines.push(`Route: ${result.routed.status}`);
    return { chatId, text: lines.join('\n') };
  }
  const { runSalesCycle } = require('../agents/sales');
  const result = runSalesCycle('This is too expensive for us right now.');
  return { chatId, text: `<b>Sales test</b>: ${result.objection_type} → ${result.suggested_action}` };
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
