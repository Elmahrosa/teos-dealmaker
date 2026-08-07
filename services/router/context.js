// services/router/context.js
// v1.1 workspace context resolution with a short-TTL cache so the first reply
// stays under the 300ms budget (Phase 14 performance). Also owns the shared
// Platform Policy Engine with the router governance pack: founder-only and
// no-billing-for-founders rules rule at the platform gate.
'use strict';

const { getWorkspaceContext } = require('../workspace');
const { createRepos } = require('../../db/repos');
const { createPolicyEngine } = require('../platform/policies');
const { REGISTRY } = require('../workforce/registry');
const universalAgents = require('../agents/registry');

const TTL_MS = 30000;
const ctxCache = new Map();
const engines = new Map();

const FOUNDER_ONLY_CAPABILITIES = ['router.founder', 'diagnostics.run', 'internal.analytics'];

function installRouterPolicies(engine) {
  engine.register({
    id: 'router.founder_only',
    name: 'Founder-only capabilities are gated to the founder',
    scope: 'router',
    priority: 20,
    fn: (r) => {
      if (!r.capability || !FOUNDER_ONLY_CAPABILITIES.includes(r.capability)) return null;
      if (r.requester && r.requester.isFounder) return null;
      return { allowed: false, reason: 'founder_only' };
    }
  });
  engine.register({
    id: 'router.no_billing_for_founders',
    name: 'Founders never see billing upsell, pricing or payment',
    scope: 'router',
    priority: 20,
    fn: (r) => {
      if (!r.capability || !['billing.view', 'billing.change', 'billing.upgrade'].includes(r.capability)) return null;
      if (r.requester && r.requester.isFounder) return { allowed: false, reason: 'founder_no_billing' };
      return null;
    }
  });
}

function policyEngineFor(adapter) {
  if (!engines.has(adapter)) {
    const repos = createRepos(adapter);
    const engine = createPolicyEngine({ repos });
    installRouterPolicies(engine);
    engines.set(adapter, engine);
  }
  return engines.get(adapter);
}

async function resolve(adapter, userId, session) {
  const cached = ctxCache.get(String(userId));
  if (cached && Date.now() - cached.at < TTL_MS) return cached.ctx;

  const wc = await getWorkspaceContext(adapter, userId);
  if (!wc) {
    ctxCache.set(String(userId), { at: Date.now(), ctx: null });
    return null;
  }

  const sessionLang = session && session.language;
  const language = sessionLang || (wc.settings && wc.settings.lang) || 'en';
  const repos = createRepos(adapter);
  const ctx = {
    userId,
    user: wc.user,
    workspace: wc.workspace,
    workspaceId: wc.workspace.id,
    isFounder: wc.isFounder,
    role: wc.role,
    membersCount: wc.membersCount,
    agents: wc.agents,
    deals: wc.deals,
    subscription: wc.subscription,
    subscriptionLabel: wc.subscriptionLabel,
    settings: wc.settings,
    language,
    agentRegistry: REGISTRY,
    universalAgents,
    policy: policyEngineFor(adapter),
    repos,
    audit: async (actionType, details) => {
      try {
        await repos.audit.add({
          workspace_id: ctx.workspaceId,
          user_id: userId,
          agent_name: 'router',
          action_type: actionType,
          details
        });
      } catch (_) {
        /* audit never breaks a reply */
      }
    }
  };
  ctxCache.set(String(userId), { at: Date.now(), ctx });
  return ctx;
}

function invalidate(userId) {
  ctxCache.delete(String(userId));
}

function reset() {
  ctxCache.clear();
  engines.clear();
}

module.exports = { resolve, invalidate, reset, installRouterPolicies };
