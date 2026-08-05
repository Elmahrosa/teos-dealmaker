const { getMode, setMode } = require('../config/mode');
const audit = require('../utils/auditLogger');
const { isFounder, isAdmin } = require('./access');
const { buildHome, buildWorkforce, buildPipeline, buildDeals, buildAudit, buildAdmin, buildMemory, buildCosts, buildHealth, buildProviders, buildQueue, buildBriefing, buildIntelligence, buildKnowledgeDocs, buildAskResult, buildIntegrations, buildLearn, buildMissions, buildApprovals, buildMissionGoalPrompt, launchGoalMission } = require('./menu');
const { formatPricingText, pricingButtons } = require('../config/pricing.config');
const i18n = require('./i18n');
const design = require('./design');
const identity = require('../services/identity');
const intelligence = require('../services/intelligence');
const learning = require('../services/learning');
const { getStoreAdapter } = require('./store');

function screenResult(chatId, screen) {
  return { chatId, text: screen.text, replyMarkup: screen.keyboard };
}

async function cmdStart(chatId, userId) {
  return screenResult(chatId, await buildHome(userId));
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

function cmdPricing(chatId, userId) {
  const lang = i18n.getLang(userId);
  return { chatId, text: formatPricingText(lang), replyMarkup: pricingButtons(lang) };
}

async function cmdWorkforce(chatId, userId) {
  return screenResult(chatId, await buildWorkforce(userId));
}

async function cmdPipeline(chatId) {
  return screenResult(chatId, buildPipeline());
}

async function cmdDeals(chatId, userId) {
  return screenResult(chatId, await buildDeals(userId));
}

async function cmdMemory(chatId, userId) {
  return screenResult(chatId, await buildMemory(userId));
}

async function cmdCosts(chatId, userId) {
  return screenResult(chatId, await buildCosts(userId));
}

async function cmdHealth(chatId, userId) {
  return screenResult(chatId, await buildHealth(userId));
}

async function cmdProviders(chatId, userId) {
  return screenResult(chatId, await buildProviders(userId));
}

async function cmdQueue(chatId, userId) {
  return screenResult(chatId, await buildQueue(userId));
}

async function cmdBriefing(chatId, userId) {
  return screenResult(chatId, await buildBriefing(userId));
}

async function cmdIntelligence(chatId, userId) {
  return screenResult(chatId, await buildIntelligence(userId));
}

async function cmdDocuments(chatId, userId) {
  return screenResult(chatId, await buildKnowledgeDocs(userId));
}

async function cmdIntegrations(chatId, userId) {
  return screenResult(chatId, await buildIntegrations(userId));
}

async function cmdAsk(chatId, userId, remainder) {
  if (!remainder) {
    return {
      chatId,
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Ask Company Intelligence')}`,
        design.divider(),
        design.it('Usage: /ask <your question>'),
        design.it('Example: /ask Which plan fits a company with 300 employees?'),
        design.divider()
      ])
    };
  }
  const adapter = getStoreAdapter();
  const user = await identity.getUserByTelegram(adapter, userId);
  const workspace = user ? await identity.getWorkspaceForUser(adapter, user.id) : null;
  if (!workspace) {
    return { chatId, text: design.errorPanel('No workspace', 'Provision a workspace first with /start.').text };
  }
  const result = await intelligence.ask(adapter, workspace.id, remainder);
  return screenResult(chatId, buildAskResult(userId, remainder, result));
}

async function cmdLearn(chatId, userId) {
  const adapter = getStoreAdapter();
  const user = await identity.getUserByTelegram(adapter, userId);
  const workspace = user ? await identity.getWorkspaceForUser(adapter, user.id) : null;
  if (!workspace) return screenResult(chatId, await buildHome(userId));
  const progress = await learning.progress(adapter, workspace.id);
  return screenResult(chatId, await buildLearn(userId, progress, null));
}

async function cmdMissions(chatId, userId) {
  return screenResult(chatId, await buildMissions(userId));
}

async function cmdApprovals(chatId, userId) {
  return screenResult(chatId, await buildApprovals(userId));
}

async function cmdMission(chatId, userId, remainder) {
  if (!remainder) {
    return screenResult(chatId, await buildMissionGoalPrompt(userId));
  }
  return screenResult(chatId, await launchGoalMission(userId, remainder));
}

function cmdAdmin(chatId, userId) {
  return screenResult(chatId, buildAdmin(userId));
}

const COMMANDS = {
  '/start': cmdStart,
  '/setup': cmdStart,
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
  '/memory': cmdMemory,
  '/costs': cmdCosts,
  '/providers': cmdProviders,
  '/queue': cmdQueue,
  '/briefing': cmdBriefing,
  '/intelligence': cmdIntelligence,
  '/documents': cmdDocuments,
  '/ask': cmdAsk,
  '/integrations': cmdIntegrations,
  '/learn': cmdLearn,
  '/missions': cmdMissions,
  '/mission': cmdMission,
  '/workflow': cmdMissions,
  '/approvals': cmdApprovals,
  '/admin': cmdAdmin
};

module.exports = { COMMANDS, isFounder, isAdmin };
