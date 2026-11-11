// services/router/router.js
// v1.1 AI Revenue Operating System — message pipeline. Every message passes:
//   Intent -> Sentinel/Policy gate -> Conversation Memory -> Workspace Context
//   -> Execution -> (Founder Approval when gated) -> Audit -> Natural reply
// Approval is never bypassed: gated intents emit APPROVAL_REQUESTED and resume
// only through approvals.decide. The founder NEVER sees billing; customers
// NEVER see founder internals (enforced at the policy gate + reply builder).
'use strict';

const intent = require('./intent');
const memory = require('./memory');
const context = require('./context');
const executor = require('./executor');
const reply = require('./reply');
const fastpath = require('./fastpath');
const { EVENT_NAMES } = require('../workforce/events');

async function handleText(adapter, userId, rawText) {
  const startedAt = Date.now();
  const text = String(rawText || '').trim();
  const session = memory.get(userId);
  const detection = intent.detect(text);
  const language = detection.language;

  memory.pushMessage(userId, 'user', text);
  memory.update(userId, { currentIntent: detection.intent, language });

  const route = fastpath.classify(detection.intent);
  const ctx = await context.resolve(adapter, userId, session);
  if (!ctx) {
    // No workspace yet: conversational questions are still answered; anything
    // else points to Quick Start. Nothing runs without a workspace.
    const conversational = ['about', 'help', 'greeting'].includes(detection.intent);
    const text = conversational
      ? reply.textFor({ action: detection.intent, data: { language, isFounder: false } }, { isFounder: false, language }, session)
      : (language === 'ar'
        ? 'أهلاً بك في TEOS DealMaker. يمكنني مساعدتك في المبيعات والعملاء والصفقات، لكني أحتاج أولاً إلى مساحة عمل. اضغط «بدء سريع» أدناه أو أرسل /start.'
        : 'Welcome to TEOS DealMaker. I can help with sales, customers and deals, but I need a workspace first. Tap Quick Start below (one tap) or send /start.');
    return {
      text,
      suggestions: [],
      unlinked: true,
      action: conversational ? detection.intent : 'need_workspace',
      session,
      trace: { intent: detection.intent, action: 'need_workspace', path: 'unlinked' }
    };
  }
  memory.update(userId, { workspace: ctx.workspaceId, founderMode: ctx.isFounder });

  if (route.path === 'fast' && route.static) {
    const result = fastpath.staticResult(detection.intent, detection, ctx);
    await ctx.audit('ROUTER_FASTPATH', { intent: detection.intent, path: 'fast', action: result.action });
    const built = reply.build(result, ctx, session);
    memory.pushMessage(userId, 'assistant', built.text);
    return {
      text: built.text,
      suggestions: built.suggestions,
      session,
      trace: {
        intent: detection.intent,
        action: result.action,
        path: 'fast',
        latencyMs: Date.now() - startedAt
      }
    };
  }

  let decision = null;
  if (detection.capability) {
    decision = await ctx.policy.evaluate({
      capability: detection.capability,
      workspaceId: ctx.workspaceId,
      userId,
      requester: { isFounder: ctx.isFounder, role: ctx.role },
      payload: { text }
    });
    await ctx.audit(decision.allowed ? 'ROUTER_ALLOW' : 'ROUTER_DENY', {
      intent: detection.intent,
      capability: detection.capability,
      decision: decision.decision,
      reason: decision.reason,
      policy: decision.policy,
      trace: decision.trace
    });
    if (!decision.allowed) {
      const blocked = reply.build({ action: detection.intent === 'pricing' ? 'no_pricing' : 'blocked' }, ctx, session);
      return {
        text: blocked.text,
        suggestions: suggestionsAfterBlock(detection.intent, ctx),
        session,
        action: detection.intent === 'pricing' ? 'no_pricing' : 'blocked',
        trace: { intent: detection.intent, action: detection.intent === 'pricing' ? 'no_pricing' : 'blocked', decision: decision.decision, reason: decision.reason }
      };
    }
  }

  const step = { intent: detection.intent, capability: detection.capability, params: detection.params, language, text };
  const result = await executor.execute(adapter, step, ctx, session);
  await ctx.audit('ROUTER_' + (result.action || 'unknown').toUpperCase(), {
    intent: detection.intent,
    action: result.action,
    params: detection.params
  });

  const built = reply.build(result, ctx, session);
  memory.pushMessage(userId, 'assistant', built.text);
  return {
    text: built.text,
    suggestions: built.suggestions,
    session,
    trace: { intent: detection.intent, action: result.action, decision: decision ? decision.decision : null, path: route.path, latencyMs: Date.now() - startedAt }
  };
}

function suggestionsAfterBlock(intentName, ctx) {
  const lang = ctx.language || 'en';
  if (intentName === 'pricing' && ctx.isFounder) {
    return lang === 'ar' ? ['الحالة', 'التحليلات', 'مساعدة'] : ['Status', 'Analytics', 'Help'];
  }
  return lang === 'ar' ? ['مساعدة', 'الحالة'] : ['Help', 'Status'];
}

module.exports = { handleText, EVENT_NAMES };
