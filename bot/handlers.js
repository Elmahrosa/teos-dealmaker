const { COMMANDS } = require('./commands');
const audit = require('../utils/auditLogger');
const { getMode } = require('../config/mode');

function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from ? msg.from.id : null;
  const text = (msg.text || '').trim();

  if (!text) return null;

  if (text.startsWith('/')) {
    const parts = text.split(/\s+/);
    const command = parts[0];
    const handler = COMMANDS[command];

    if (!handler) {
      audit.writeEntry('BOT_COMMAND_UNKNOWN', String(userId), 'denied', { command, mode: getMode() });
      return { chatId, text: `Unknown command: <code>${command}</code>. Use /start for help.` };
    }

    const actionType = 'BOT_COMMAND_' + command.slice(1).toUpperCase();

    try {
      const result = handler(chatId, userId, parts[1] ? Number(parts[1]) : undefined);
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
