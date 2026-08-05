// services/platform/tenants/index.js
// Tenant context resolver. Turns a workspace id into the tenant context the
// rest of the platform layer depends on: workspace identity, plan, and
// subscription state. Pure data resolution — no enforcement happens here,
// enforcement lives in entitlements and authorization.
'use strict';

function createTenants(repos) {
  async function resolve(workspaceId) {
    const workspace = await repos.workspaces.get(workspaceId);
    if (!workspace) return { ok: false, error: 'tenant_not_found', workspaceId };
    const subscription = await repos.subscriptions.get(workspaceId);
    const plan = workspace.plan || (subscription && subscription.plan) || 'solo';
    const status = workspace.status || 'active';
    return {
      ok: true,
      workspaceId,
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, plan, status },
      subscription: subscription
        ? { id: subscription.id, plan: subscription.plan, status: subscription.status, cycle: subscription.cycle, renewal_date: subscription.renewal_date }
        : null,
      plan,
      active: status === 'active'
    };
  }

  async function requireWorkspace(workspaceId) {
    const ctx = await resolve(workspaceId);
    if (!ctx.ok) return { ok: false, error: ctx.error, workspaceId };
    if (!ctx.active) {
      return { ok: false, error: 'tenant_inactive', workspaceId, reason: `workspace status is ${ctx.workspace.status}` };
    }
    return { ok: true, ctx };
  }

  return { resolve, requireWorkspace };
}

module.exports = { createTenants };
