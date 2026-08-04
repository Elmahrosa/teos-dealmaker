// services/platform/entitlements/index.js
// Entitlement checks: subscription/license validity, plan limits (seats,
// agents), capability scope grants, plugin install allowances, and usage
// quotas. Consumes the existing db repositories — no duplicate persistence.
'use strict';

const { PLANS, LIMIT_UNLIMITED } = require('./plans');

const PLUGIN_NAMESPACES = ['civic', 'sentinel'];

function scopeFor(capability) {
  const namespace = String(capability || '').split('.')[0];
  if (PLUGIN_NAMESPACES.includes(namespace)) return 'plugin';
  if (namespace && String(capability).includes('.')) return 'custom';
  return 'core';
}

function createEntitlements(repos, opts) {
  const o = opts || {};
  const catalog = o.plans || PLANS;
  const isUnlimited = (value) => value === LIMIT_UNLIMITED;
  const VALID_SUBSCRIPTION_STATUSES = ['active', 'pending', 'trialing'];

  async function planFor(workspaceId) {
    const workspace = await repos.workspaces.get(workspaceId);
    if (!workspace) return null;
    const subscription = await repos.subscriptions.get(workspaceId);
    const planId = workspace.plan || (subscription && subscription.plan) || 'free';
    return { workspace, subscription, planId, plan: catalog[planId] || catalog.free };
  }

  async function license(workspaceId) {
    const ctx = await planFor(workspaceId);
    if (!ctx) return { ok: false, error: 'tenant_not_found', workspaceId };
    const subscriptionValid = !ctx.subscription || VALID_SUBSCRIPTION_STATUSES.includes(ctx.subscription.status);
    const valid = subscriptionValid && ctx.workspace.status === 'active';
    return {
      ok: true,
      workspaceId,
      plan: ctx.planId,
      tier: ctx.plan.tier,
      subscription: ctx.subscription
        ? { id: ctx.subscription.id, status: ctx.subscription.status, cycle: ctx.subscription.cycle, renewal_date: ctx.subscription.renewal_date }
        : null,
      subscriptionValid,
      valid
    };
  }

  async function validate(workspaceId) {
    const lic = await license(workspaceId);
    if (!lic.ok) return lic;
    if (!lic.valid) {
      return {
        ok: false,
        error: 'entitlement_invalid',
        workspaceId,
        plan: lic.plan,
        reason: lic.subscriptionValid ? 'workspace_inactive' : 'subscription_inactive',
        subscription: lic.subscription
      };
    }
    return { ok: true, license: lic };
  }

  async function limit(workspaceId) {
    const ctx = await planFor(workspaceId);
    if (!ctx) return { ok: false, error: 'tenant_not_found', workspaceId };
    return { ok: true, workspaceId, plan: ctx.planId, limits: ctx.plan };
  }

  async function checkSeats(workspaceId) {
    const lim = await limit(workspaceId);
    if (!lim.ok) return lim;
    const members = await repos.members.list(workspaceId);
    const seats = members.length;
    if (!isUnlimited(lim.limits.seats) && seats >= lim.limits.seats) {
      return { ok: false, error: 'seat_limit_exceeded', workspaceId, plan: lim.plan, seats, limit: lim.limits.seats };
    }
    return {
      ok: true,
      workspaceId,
      plan: lim.plan,
      seats,
      limit: lim.limits.seats,
      remaining: isUnlimited(lim.limits.seats) ? null : lim.limits.seats - seats
    };
  }

  async function checkAgents(workspaceId) {
    const lim = await limit(workspaceId);
    if (!lim.ok) return lim;
    const rows = await repos.agents.list(workspaceId);
    const active = rows.filter((a) => a.status === 'active' || a.status === 'ready').length;
    if (!isUnlimited(lim.limits.agents) && active >= lim.limits.agents) {
      return { ok: false, error: 'agent_limit_exceeded', workspaceId, plan: lim.plan, active, limit: lim.limits.agents };
    }
    return {
      ok: true,
      workspaceId,
      plan: lim.plan,
      active,
      limit: lim.limits.agents,
      remaining: isUnlimited(lim.limits.agents) ? null : lim.limits.agents - active
    };
  }

  async function checkCapability(workspaceId, capability) {
    const lim = await limit(workspaceId);
    if (!lim.ok) return lim;
    const scope = o.scopeFor ? o.scopeFor(capability) : scopeFor(capability);
    const allowedScopes = lim.limits.capabilityScopes;
    const allowed = allowedScopes.includes('*') || allowedScopes.includes(scope);
    if (!allowed) {
      return {
        ok: false,
        error: 'capability_not_entitled',
        workspaceId,
        plan: lim.plan,
        capability,
        scope,
        allowedScopes
      };
    }
    return { ok: true, workspaceId, plan: lim.plan, capability, scope, allowed: true };
  }

  async function checkPluginInstall(workspaceId, pluginId) {
    const lim = await limit(workspaceId);
    if (!lim.ok) return lim;
    const allowedPlugins = lim.limits.plugins;
    const allowed = allowedPlugins.includes('*') || allowedPlugins.includes(pluginId);
    if (!allowed) {
      return {
        ok: false,
        error: 'plugin_not_entitled',
        workspaceId,
        plan: lim.plan,
        plugin: pluginId,
        allowedPlugins
      };
    }
    return { ok: true, workspaceId, plan: lim.plan, plugin: pluginId, allowed: true };
  }

  async function checkUsage(workspaceId) {
    const lim = await limit(workspaceId);
    if (!lim.ok) return lim;
    const cap = lim.limits.usage;
    if (isUnlimited(cap.cost_cents_month) && isUnlimited(cap.token_month)) {
      return { ok: true, workspaceId, plan: lim.plan, unlimited: true, usage: null, limit: cap };
    }
    const usage = await repos.usage.sum(workspaceId);
    const overCost = cap.cost_cents_month !== 0 && usage.cost_cents >= cap.cost_cents_month;
    const overTokens = cap.token_month !== 0 && (usage.input_tokens + usage.output_tokens) >= cap.token_month;
    if (overCost || overTokens) {
      return { ok: false, error: 'usage_quota_exceeded', workspaceId, plan: lim.plan, usage, limit: cap };
    }
    return { ok: true, workspaceId, plan: lim.plan, unlimited: false, usage, limit: cap };
  }

  return {
    license,
    validate,
    limit,
    checkSeats,
    checkAgents,
    checkCapability,
    checkPluginInstall,
    checkUsage,
    scopeFor: (capability) => (o.scopeFor ? o.scopeFor(capability) : scopeFor(capability)),
    plans: catalog
  };
}

module.exports = { createEntitlements, scopeFor, PLUGIN_NAMESPACES };
