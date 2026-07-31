const { COMMANDS } = require('./commands');
const onboarding = require('./onboarding');
const identity = require('../services/identity');
const { getStoreAdapter } = require('./store');
const { buildHome } = require('./menu');
const audit = require('../utils/auditLogger');
const { getMode } = require('../config/mode');

function screenResult(chatId, screen) {
  return { chatId, text: screen.text, replyMarkup: screen.keyboard };
}

async function handleStart(chatId, userId) {
  if (onboarding.isActive(userId)) {
    const sc = onboarding.prompt(userId);
    return { chatId, text: sc.text, replyMarkup: sc.keyboard };
  }

  const adapter = getStoreAdapter();
  try {
    const user = await identity.ensureUser(adapter, userId, {
      display_name: msg.from ? msg.from.first_name : null
    });
    const workspace = user ? await identity.getWorkspaceForUser(adapter, user.id) : null;
    if (workspace) {
      audit.writeEntry('BOT_START_EXISTING', String(userId), 'success', {
        workspaceId: workspace.id,
        mode: getMode()
      });
      return screenResult(chatId, await buildHome(userId));
    }
  } catch (err) {
    console.error('[handlers] identity lookup failed:', err.message);
  }

  const sc = onboarding.start(userId);
  return { chatId, text: sc.text, replyMarkup: sc.keyboard };
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from ? msg.from.id : null;
  const text = (msg.text || '').trim();

  if (!text) return null;

  if (onboarding.isActive(userId) && !text.startsWith('/')) {
    return onboarding.handleText(chatId, userId, text);
  }

  if (text.startsWith('/')) {
    const parts = text.split(/\s+/);
    const command = parts[0];

    if (command === '/start' || command === '/setup') {
      return handleStart(chatId, userId);
    }

    const handler = COMMANDS[command];

    if (!handler) {
      audit.writeEntry('BOT_COMMAND_UNKNOWN', String(userId), 'denied', { command, mode: getMode() });
      return { chatId, text: `Unknown command: <code>${command}</code>. Use /start for help.` };
    }

    const actionType = 'BOT_COMMAND_' + command.slice(1).toUpperCase();
    const remainder = parts.slice(1).join(' ').trim();

    try {
      const result = await handler(chatId, userId, remainder);
      audit.writeEntry(actionType, command, 'success', { userId, mode: getMode() });
      return result;
    } catch (err) {
      audit.writeEntry(actionType, command, 'error', { userId, error: err.message });
      return { chatId, text: `Error: ${err.message}` };
    }
  }

  audit.writeEntry('BOT_TEXT', String(userId), 'info', { text, mode: getMode() });
  return {
    chatId,
    text: `Received (${getMode()} mode). In this build, free text routes through the agents in DRY mode.\n\nUse /start for commands.`
  };
}

module.exports = { handleMessage };
