const { getMode, setMode } = require('../config/mode');
const audit = require('../utils/auditLogger');
const { BOT_CONFIG } = require('./config');
const { isFounder, isAdmin } = require('./access');
const { buildHome, buildWorkforce, buildPipeline, buildDeals, buildAudit, buildAdmin, buildPricing } = require('./menu');
const { formatPricingText, pricingButtons } = require('../config/pricing.config');
const design = require('./design');

function screenResult(chatId, screen) {
  return { chatId, text: screen.text, replyMarkup: screen.keyboard };
}

function cmdStart(chatId) {
  return screenResult(chatId, buildHome());
}

function cmdHealth(chatId) {
  const entries = audit.readVault();
  const last = entries[entries.length - 1];
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Health Check')}`,
    design.it('System status'),
    design.divider(),
    design.row('Mode', design.modeBadge(getMode())),
    design.row('Bot', `@${BOT_CONFIG.botName}`),
    design.row('Audit entries', `${entries.length}`),
    design.row('Last activity', last ? `${last.action} · ${(last.timestamp || '').slice(11, 19)}` : '—'),
    design.row('Timestamp', new Date().toISOString()),
    design.divider()
  ]);
  return { chatId, text };
}

function cmdMode(chatId) {
  const text = design.compose([
    design.row('Current mode', design.modeBadge(getMode()))
  ]);
  return { chatId, text };
}

function cmdLive(chatId, userId) {
  if (!isFounder(userId)) {
    audit.writeEntry('BOT_LIVE_DENIED', String(userId), 'denied', { reason: 'not founder' });
    return { chatId, text: design.errorPanel('Access denied', 'Founder only.').text };
  }
  setMode('LIVE');
  audit.writeEntry('BOT_MODE', 'system', 'success', { mode: 'LIVE', by: userId });
  return { chatId, text: `${design.row('Mode', design.modeBadge('LIVE'))}\n\n${design.it('Live dispatch enabled.')}` };
}

function cmdDry(chatId, userId) {
  if (!isAdmin(userId)) {
    return { chatId, text: design.errorPanel('Access denied', 'Admin only.').text };
  }
  setMode('DRY');
  audit.writeEntry('BOT_MODE', 'system', 'success', { mode: 'DRY', by: userId });
  return { chatId, text: `${design.row('Mode', design.modeBadge('DRY'))}\n\n${design.it('Vault-only protection enabled.')}` };
}

function cmdAudit(chatId, userId) {
  if (!isAdmin(userId)) {
    return { chatId, text: design.errorPanel('Access denied', 'Admin only.').text };
  }
  return screenResult(chatId, buildAudit(0));
}

function cmdOutreach(chatId) {
  const { runOutreachCycle } = require('../agents/outreach');
  const result = runOutreachCycle({
    name: 'Telegram (Test)',
    email: 'test@example.com',
    template: 'intro'
  });
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Outreach')}`,
    design.it('Draft review and dispatch'),
    design.divider(),
    design.row('Status', result.status),
    design.row('Message ID', design.code(result.message_id)),
    design.divider()
  ]);
  return { chatId, text };
}

function cmdQualify(chatId) {
  const { processResponse } = require('../agents/qualification');
  const result = processResponse({
    id: 'tg_' + Date.now(),
    from: 'telegram@test.com',
    body: 'Sounds great! Let us schedule a demo.',
    industry: 'ai'
  });
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Qualification')}`,
    design.it('BANT classification'),
    design.divider(),
    design.row('Action', result.routing.action),
    design.row('Route', result.routing.target_agent || 'archive'),
    design.divider()
  ]);
  return { chatId, text };
}

function cmdSales(chatId, userId, prompt) {
  if (!prompt) {
    const text = design.compose([
      `${design.EMOJI.ai} ${design.b('Sales Flow')}`,
      design.it('Provide the objection to process.'),
      design.divider(),
      `${design.row('Example', design.code('/sales The price is too high'))}`,
      design.divider()
    ]);
    return { chatId, text };
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

    const text = design.compose([
      `${design.EMOJI.ai} ${design.b('Sales Flow')}`,
      design.it('Orchestrator → Sales → Gatekeeper'),
      design.divider(),
      design.row('Status', design.badge(result.status === 'success' ? 'success' : 'warning')),
      design.row('Objection', result.draft.objectionType),
      design.row('Gatekeeper', design.badge(result.review.decision === 'APPROVE' ? 'success' : 'warning')),
      design.row('Draft', design.code(result.draft.draft)),
      design.row('Route', result.routed ? result.routed.status : 'blocked'),
      design.divider()
    ]);
    return { chatId, text };
  } catch (error) {
    audit.writeEntry('BOT_COMMAND_SALES_ERROR', String(userId), 'error', {
      error: error.message,
      command: '/sales'
    });
    const text = design.compose([
      design.errorPanel('Request failed', 'The incident has been logged.'),
      design.row('Reference', String(userId)),
      design.divider()
    ]);
    return { chatId, text };
  }
}

function cmdPricing(chatId) {
  return { chatId, text: formatPricingText(), replyMarkup: pricingButtons() };
}

function cmdWorkforce(chatId) {
  return screenResult(chatId, buildWorkforce());
}

function cmdPipeline(chatId) {
  return screenResult(chatId, buildPipeline());
}

function cmdDeals(chatId) {
  return screenResult(chatId, buildDeals());
}

function cmdAdmin(chatId, userId) {
  return screenResult(chatId, buildAdmin(userId));
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
  '/sales': cmdSales,
  '/pricing': cmdPricing,
  '/workforce': cmdWorkforce,
  '/pipeline': cmdPipeline,
  '/deals': cmdDeals,
  '/admin': cmdAdmin
};

module.exports = { COMMANDS, isFounder, isAdmin };
