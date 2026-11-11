const { COMMANDS } = require('./commands');
const onboarding = require('./onboarding');
const i18n = require('./i18n');
const identity = require('../services/identity');
const memory = require('../services/memory');
const intelligence = require('../services/intelligence');
const memoryEdit = require('./memoryEdit');
const knowledgeState = require('./knowledgeState');
const missionState = require('./missionState');
const dealInput = require('./dealInput');
const botLearning = require('./learning');
const { getStoreAdapter } = require('./store');
const design = require('./design');
const { esc } = design;
const { buildHome, buildMemory, buildAskResult, buildMissionRunResult } = require('./menu');
const audit = require('../utils/auditLogger');
const { getMode } = require('../config/mode');
const { isFounder } = require('./access');
const router = require('../services/router');

function screenResult(chatId, screen) {
  return { chatId, text: screen.text, replyMarkup: screen.keyboard };
}

// Conversational answers carry one inline row that routes to the right function.
const GUIDE_ACTIONS = new Set(['greeting', 'help', 'about', 'unknown', 'blocked', 'no_pricing', 'pricing']);

function guideKeyboard(userId) {
  const tr = key => i18n.t(userId, key);
  return design.keyboard([
    [design.textButton(tr('btn_run_pipeline'), 'cc_pipeline_run'), design.textButton(tr('btn_deals'), 'cc_deals')],
    [design.textButton(tr('btn_back_home'), 'cc_home')]
  ]);
}

async function routerResult(chatId, userId, rawText) {
  const text = String(rawText || '').trim().replace(/^\/+/, '');
  if (!text) return null;
  const adapter = getStoreAdapter();
  const reply = await router.handleText(adapter, userId, text);
  const trace = reply.trace || {};
  audit.writeEntry('BOT_ROUTER', String(userId), 'success', {
    intent: trace.intent,
    action: trace.action,
    decision: trace.decision
  });
  // Inline buttons only. The persistent Reply Keyboard (Run sales / Status /
  // Help ...) is retired: it forced sales and mission commands on every user.
  let replyMarkup = null;
  let outText = reply.text;
  const action = reply.action || trace.action;
  if (reply.unlinked) {
    // No workspace yet: answer the question, then offer Quick Start.
    const sc = onboarding.start(userId);
    outText = `${reply.text}\n\n${sc.text}`;
    replyMarkup = sc.keyboard;
  } else if (GUIDE_ACTIONS.has(action)) {
    replyMarkup = guideKeyboard(userId);
  }
  const result = { chatId, text: outText, replyMarkup };
  result.__isAI = (action === 'knowledge');
  return result;
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

function clearPendingInputState(userId) {
  onboarding.reset(userId);
  botLearning.clear(userId);
  knowledgeState.clear(userId);
  memoryEdit.clear(userId);
  missionState.clear(userId);
    dealInput.clear(userId);
}

async function runSellMission(chatId, userId, goal, durationHours = 3) {
  const adapter = getStoreAdapter();
  const user = await identity.getUserByTelegram(adapter, userId);
  const workspace = user ? await identity.getWorkspaceForUser(adapter, user.id) : null;
  if (!workspace) {
    return { chatId, text: 'No workspace found. Run /start to provision one.' };
  }
  const runtime = require('../services/workforce/runtime');
  const result = await runtime.runGoal(adapter, workspace.id, goal, {
    title: goal.slice(0, 120),
    priority: 'high',
    durationHours: durationHours || 3
  });
  audit.writeEntry('BOT_UNIVERSAL_SELL_MISSION', String(userId), 'success', {
    planId: result.plan.id,
    status: result.status,
    durationHours: durationHours || 3
  });
  const screen = await buildMissionRunResult(userId, result.plan.id, result);
  return { chatId, text: screen.text, replyMarkup: screen.keyboard };
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from ? msg.from.id : null;
  const text = (msg.text || '').trim();

  // Empty or non-text updates (stickers, photos, blank text) never dead-end.
  if (!text) return { chatId, text: i18n.t(userId, 'fallback_nontext') };

  // Founder escape hatch: never trap a new request inside an unfinished form.
  // /cancel clears every conversational input state; /new starts a fresh goal.
  const commandText = text.split(/\s+/)[0].toLowerCase().replace(/@[^@]+$/, '');
  // Any command other than /start abandons a half-finished setup.
  if (text.startsWith('/') && commandText !== '/start' && onboarding.isActive(userId)) onboarding.reset(userId);
  if (commandText === '/cancel') {
    clearPendingInputState(userId);
    audit.writeEntry('BOT_INPUT_CANCELLED', String(userId), 'success', { mode: getMode() });
    return { chatId, text: 'Cancelled. Your previous input flow is cleared. Send a new request whenever you are ready.' };
  }
  if (commandText === '/new') {
    clearPendingInputState(userId);
    const request = text.replace(/^\/new(?:@[^\s]+)?\s*/i, '').trim();
    if (!request) {
      return { chatId, text: 'Send one request after /new. Example: /new Find 30 companies in Saudi Arabia that may need TEOS domains.' };
    }
    audit.writeEntry('BOT_NEW_REQUEST', String(userId), 'in_progress', { mode: getMode(), request_length: request.length });
    const routed = await routerResult(chatId, userId, request);
    return routed || { chatId, text: 'I could not route that request. Try /new with a clearer goal.' };
  }

  if (dealInput.pending(userId) && (!text.startsWith('/') || commandText === '/skip')) {
    const inputResult = dealInput.handle(userId, text);

    if (!inputResult.done) {
      return { chatId, text: inputResult.prompt };
    }

    const tr = key => i18n.t(userId, key);
    try {
      const adapter = getStoreAdapter();
      const user = await identity.getUserByTelegram(adapter, userId);
      const workspace = user
        ? await identity.getWorkspaceForUser(adapter, user.id)
        : null;

      if (!workspace) {
        return { chatId, text: tr('di_no_workspace') };
      }

      const pipeline = require('../services/workforce/pipeline');
      const result = await pipeline.runPipeline(adapter, workspace.id, inputResult.data);

      if (!result.ok) {
        return { chatId, text: i18n.sprintf(tr('di_not_started'), esc(result.reason || 'unknown')) };
      }

      audit.writeEntry('BOT_ASSET_PIPELINE_COMPLETED', String(userId), 'success', {
        assetType: inputResult.data.assetType,
        hasSourceUrl: Boolean(inputResult.data.sourceUrl),
        dryRun: Boolean(result.dry_run),
        dealId: (result.deal && result.deal.id) || null
      });

      const screen = require('./screens').buildPipelineResult(userId, result);
      const note = result.dry_run ? `\n\n${esc(tr('di_dry_note'))}` : '';
      return { chatId, text: screen.text + note, replyMarkup: screen.keyboard };
    } catch (err) {
      audit.writeEntry('BOT_ASSET_PIPELINE_ERROR', String(userId), 'error', {
        error: err.message
      });
      return { chatId, text: tr('di_failed') };
    }
  }
  if (onboarding.isActive(userId) && !text.startsWith('/')) {
    // Only an explicit "enter company name" step consumes free text; anything
    // else falls through and is answered as an ordinary message.
    const onb = await onboarding.handleText(chatId, userId, text);
    if (onb) return onb;
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
      return { chatId, text: i18n.t(userId, 'err_request_failed') };
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
        const screen = screenResult(chatId, buildAskResult(userId, text, result));
        screen.__isAI = true;
        return screen;
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
      return { chatId, text: i18n.t(userId, 'err_request_failed') };
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
      return { chatId, text: i18n.t(userId, 'err_request_failed') };
    }
  }

  if (missionState.pending(userId) && !text.startsWith('/')) {
    const payload = missionState.payload(userId) || {};
    if (payload.mode === 'mission_create') {
      try {
        return await require('./screens/missions').handleMissionCreateText(chatId, userId, text);
      } catch (err) {
        audit.writeEntry('BOT_MISSION_CREATE', String(userId), 'error', { error: err.message });
        return { chatId, text: i18n.t(userId, 'err_request_failed') };
      }
    }
    missionState.clear(userId);
    dealInput.clear(userId);
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
      const screen = screenResult(chatId, await buildMissionRunResult(userId, result.plan.id, result));
      screen.__isAI = true;
      return screen;
    } catch (err) {
      audit.writeEntry('BOT_MISSION_GOAL', String(userId), 'error', { error: err.message });
      return { chatId, text: i18n.t(userId, 'err_request_failed') };
    }
  }

  // One-line universal sales mission: "Sell [offer]" or "Sell 12h [offer]".
  const sellMatch = text.match(/^(?:\/sell|sell|ط¨ظٹط¹)\s+(?:(3|12|24)\s*(?:h|hours?|ط³ط§ط¹ط©|ط³ط§ط¹ط§طھ)\s+)?([\s\S]+)$/i);
  if (sellMatch) {
    try {
      return await runSellMission(chatId, userId, sellMatch[2].trim(), Number(sellMatch[1]) || 3);
    } catch (err) {
      audit.writeEntry('BOT_UNIVERSAL_SELL_MISSION', String(userId), 'error', { error: err.message });
      return { chatId, text: i18n.t(userId, 'err_request_failed') };
    }
  }

  if (text.startsWith('/')) {
    const parts = text.split(/\s+/);
    const command = parts[0];

    if (command === '/start' || command === '/setup') {
      return handleStart(chatId, userId, msg.from ? msg.from.first_name : null);
    }

    if (command === '/help') {
      const helped = await routerResult(chatId, userId, 'help');
      if (helped) return helped;
    }

    const handler = COMMANDS[command];

    if (!handler) {
      audit.writeEntry('BOT_COMMAND_UNKNOWN', String(userId), 'denied', { command, mode: getMode() });
      const routed = await routerResult(chatId, userId, parts.slice(1).join(' ') || command.slice(1));
      return routed || { chatId, text: `${i18n.t(userId, 'fallback_unknown_cmd')} <code>${esc(command)}</code>` };
    }

    const actionType = 'BOT_COMMAND_' + command.slice(1).toUpperCase();
    const remainder = parts.slice(1).join(' ').trim();

    try {
      const result = await handler(chatId, userId, remainder);
      audit.writeEntry(actionType, command, 'success', { userId, mode: getMode() });
      return result;
    } catch (err) {
      audit.writeEntry(actionType, command, 'error', { userId, error: err.message });
      return { chatId, text: i18n.t(userId, 'err_request_failed') };
    }
  }

  audit.writeEntry('BOT_TEXT', String(userId), 'info', { text, mode: getMode() });
  const routed = await routerResult(chatId, userId, text);
  if (routed) return routed;
  return { chatId, text: i18n.t(userId, 'fallback_help') };
}

module.exports = { handleMessage };
