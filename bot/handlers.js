const { COMMANDS } = require('./commands');
const onboarding = require('./onboarding');
const i18n = require('./i18n');
const identity = require('../services/identity');
const memory = require('../services/memory');
const intelligence = require('../services/intelligence');
const memoryEdit = require('./memoryEdit');
const knowledgeState = require('./knowledgeState');
const missionState = require('./missionState');
const botLearning = require('./learning');
const { getStoreAdapter } = require('./store');
const { buildHome, buildMemory, buildAskResult, buildMissionRunResult } = require('./menu');
const audit = require('../utils/auditLogger');
const { getMode } = require('../config/mode');
const { isFounder } = require('./access');

function screenResult(chatId, screen) {
  return { chatId, text: screen.text, replyMarkup: screen.keyboard };
}

async function handleStart(chatId, userId, displayName) {
  // Founder Mode: skip onboarding, subscription and payment gates entirely.
  if (isFounder(userId)) {
    const adapter = getStoreAdapter();
    try {
      const user = await identity.ensureUser(adapter, userId, {
        display_name: displayName || null
      });
      if (user && !(await identity.getWorkspaceForUser(adapter, user.id))) {
        await identity.onboardWorkspace(adapter, {
          ownerUserId: user.id,
          companyName: (displayName || 'Founder') + ' Workspace',
          lang: i18n.getLang(userId),
          plan: 'founder'
        });
      }
    } catch (err) {
      console.error('[handlers] founder workspace failed:', err.message);
    }
    audit.writeEntry('BOT_START_FOUNDER', String(userId), 'success', { mode: getMode() });
    return screenResult(chatId, await buildHome(userId));
  }

  if (onboarding.isActive(userId)) {
    const sc = onboarding.prompt(userId);
    return { chatId, text: sc.text, replyMarkup: sc.keyboard };
  }

  const adapter = getStoreAdapter();
  try {
    const user = await identity.ensureUser(adapter, userId, {
      display_name: displayName || null
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

function parseMemoryValue(key, text) {
  const listKeys = ['products', 'services', 'competitors', 'languages', 'documents', 'preferred_providers'];
  if (listKeys.includes(key)) {
    return text.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (key === 'icp') {
    const icp = {};
    for (const part of text.split(';')) {
      const [k, v] = part.split(':').map(s => s.trim());
      if (!k || !v) continue;
      if (k === 'industries' || k === 'geos') icp[k] = v.split(',').map(s => s.trim()).filter(Boolean);
      else icp[k] = v;
    }
    return icp;
  }
  return text;
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from ? msg.from.id : null;
  const text = (msg.text || '').trim();

  if (!text) return null;

  if (onboarding.isActive(userId) && !text.startsWith('/')) {
    return onboarding.handleText(chatId, userId, text);
  }

  if (botLearning.pending(userId) && !text.startsWith('/')) {
    const adapter = getStoreAdapter();
    try {
      const user = await identity.getUserByTelegram(adapter, userId);
      const workspace = user ? await identity.getWorkspaceForUser(adapter, user.id) : null;
      if (!workspace) {
        return { chatId, text: 'No workspace found. Run /start to provision one.' };
      }
      const res = await botLearning.handleAnswer(userId, adapter, workspace.id, text);
      if (res.type === 'finished') {
        botLearning.clear(userId);
        return { chatId, text: res.prompt, replyMarkup: res.keyboard };
      }
      return { chatId, text: res.prompt, replyMarkup: res.keyboard };
    } catch (err) {
      audit.writeEntry('BOT_LEARNING_ERROR', String(userId), 'error', { error: err.message });
      return { chatId, text: `Learning update failed: ${err.message}` };
    }
  }

  const kgFlow = knowledgeState.pending(userId);
  if (kgFlow && !text.startsWith('/')) {
    const adapter = getStoreAdapter();
    try {
      const user = await identity.getUserByTelegram(adapter, userId);
      const workspace = user ? await identity.getWorkspaceForUser(adapter, user.id) : null;
      if (!workspace) {
        return { chatId, text: 'No workspace found. Run /start to provision one.' };
      }
      if (kgFlow === 'kg_ask') {
        knowledgeState.clear(userId);
        audit.writeEntry('BOT_INTEL_ASK', String(userId), 'success', { mode: getMode() });
        const result = await intelligence.ask(adapter, workspace.id, text);
        return screenResult(chatId, buildAskResult(userId, text, result));
      }
      if (kgFlow === 'kg_add') {
        const payload = knowledgeState.payload(userId) || {};
        knowledgeState.clear(userId);
        const lines = text.split(/\n+/).filter(l => l.trim());
        const title = payload.title || (lines.length > 1 ? lines[0].slice(0, 80) : 'Document');
        const content = lines.length > 1 ? lines.slice(1).join('\n') : text;
        await intelligence.addDocument(adapter, workspace.id, {
          title,
          source_type: payload.source_type || 'documents',
          content
        });
        audit.writeEntry('BOT_INTEL_DOC_ADD', String(userId), 'success', { title, source: payload.source_type || 'documents' });
        const { buildKnowledgeDocs } = require('./menu');
        return screenResult(chatId, await buildKnowledgeDocs(userId));
      }
    } catch (err) {
      audit.writeEntry('BOT_INTEL_ERROR', String(userId), 'error', { error: err.message });
      return { chatId, text: `Intelligence update failed: ${err.message}` };
    }
  }

  const pendingKey = memoryEdit.pending(userId);
  if (pendingKey && !text.startsWith('/')) {
    memoryEdit.clear(userId);
    const adapter = getStoreAdapter();
    try {
      const user = await identity.getUserByTelegram(adapter, userId);
      const workspace = user ? await identity.getWorkspaceForUser(adapter, user.id) : null;
      if (!workspace) {
        return { chatId, text: 'No workspace found. Run /start to provision one.' };
      }
      const value = parseMemoryValue(pendingKey, text);
      await memory.setMemory(adapter, workspace.id, pendingKey, value);
      audit.writeEntry('BOT_MEMORY_UPDATE', String(userId), 'success', { key: pendingKey, mode: getMode() });
      return screenResult(chatId, await buildMemory(userId));
    } catch (err) {
      audit.writeEntry('BOT_MEMORY_UPDATE', String(userId), 'error', { key: pendingKey, error: err.message });
      return { chatId, text: `Memory update failed: ${err.message}` };
    }
  }

  if (missionState.pending(userId) && !text.startsWith('/')) {
    missionState.clear(userId);
    const adapter = getStoreAdapter();
    try {
      const user = await identity.getUserByTelegram(adapter, userId);
      const workspace = user ? await identity.getWorkspaceForUser(adapter, user.id) : null;
      if (!workspace) {
        return { chatId, text: 'No workspace found. Run /start to provision one.' };
      }
      const runtime = require('../services/workforce/runtime');
      const result = await runtime.runGoal(adapter, workspace.id, text, { title: text.slice(0, 120), priority: 'high' });
      audit.writeEntry('BOT_MISSION_GOAL', String(userId), 'success', { planId: result.plan.id, status: result.status });
      return screenResult(chatId, await buildMissionRunResult(userId, result.plan.id, result));
    } catch (err) {
      audit.writeEntry('BOT_MISSION_GOAL', String(userId), 'error', { error: err.message });
      return { chatId, text: `Mission failed: ${err.message}` };
    }
  }

  if (text.startsWith('/')) {
    const parts = text.split(/\s+/);
    const command = parts[0];

    if (command === '/start' || command === '/setup') {
      return handleStart(chatId, userId, msg.from ? msg.from.first_name : null);
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
    text: 'Received. Use /start to open Mission Control, or /help for available commands.'
  };
}

module.exports = { handleMessage };
