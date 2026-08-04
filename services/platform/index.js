// services/platform/index.js
// Enterprise Platform Foundation facade. Everything enterprise belongs here:
// tenants (workspace resolution), entitlements (license, plan, limits,
// quotas), and authorization (RBAC capability grants). Consumes the existing
// db repositories — no schema changes, no duplicate persistence. The platform
// is wired into the runtime only at the executeCapability() gate and only when
// enterprise mode is enabled (TEOS_ENTERPRISE=true); otherwise it is inert.
'use strict';

const { createRepos } = require('../../db/repos');
const { createMemoryAdapter } = require('../../db/adapter');
const { createTenants } = require('./tenants');
const { createEntitlements } = require('./entitlements');
const { createAuthorization } = require('./authorization');

function defaultRepos() {
  let adapter = null;
  if (process.env.DATABASE_URL) {
    try {
      adapter = require('../../db').getAdapter();
    } catch (_) {
      /* fall through to the in-memory adapter */
    }
  }
  if (!adapter) adapter = createMemoryAdapter();
  return createRepos(adapter);
}

function createPlatform(opts) {
  const o = opts || {};
  let repos = o.repos;
  if (!repos && o.adapter) repos = createRepos(o.adapter);
  if (!repos) repos = defaultRepos();

  const tenants = o.tenants || createTenants(repos);
  const entitlements = o.entitlements || createEntitlements(repos, o);
  const authorization = o.authorization || createAuthorization(repos, o);
  const enterprise = o.enterprise !== undefined
    ? Boolean(o.enterprise)
    : (process.env.TEOS_ENTERPRISE === 'true' || process.env.ENTERPRISE_MODE === 'true');

  async function resolveWorkspace(workspaceId) {
    return repos.workspaces.get(workspaceId);
  }

  async function resolveTenant(workspaceId) {
    return tenants.resolve(workspaceId);
  }

  async function resolveSubscription(workspaceId) {
    return repos.subscriptions.get(workspaceId);
  }

  async function resolvePlan(workspaceId) {
    return entitlements.limit(workspaceId);
  }

  async function checkQuota(workspaceId) {
    return entitlements.checkUsage(workspaceId);
  }

  async function canUseCapability({ workspaceId, userId, role, capability, requester }) {
    if (!enterprise) return { allowed: true, reason: 'platform_inert' };
    if (!capability) return { allowed: false, reason: 'capability_required' };
    const tenant = await tenants.resolve(workspaceId);
    if (!tenant.ok) return { allowed: false, reason: tenant.error, workspaceId };
    if (!tenant.active) return { allowed: false, reason: 'tenant_inactive', workspaceId };
    const lic = await entitlements.validate(workspaceId);
    if (!lic.ok) return { allowed: false, reason: lic.reason || lic.error, workspaceId, plan: lic.plan };
    const cap = await entitlements.checkCapability(workspaceId, capability);
    if (!cap.ok) return { allowed: false, reason: cap.error, workspaceId, capability };
    const auth = await authorization.authorize({ workspaceId, userId, role, capability, requester });
    if (!auth.allowed) return { allowed: false, reason: auth.reason, workspaceId, capability, role: auth.role, required: auth.required };
    return { allowed: true, workspaceId, capability, plan: lic.license.plan };
  }

  return {
    repos,
    tenants,
    entitlements,
    authorization,
    resolveWorkspace,
    resolveTenant,
    resolveSubscription,
    resolvePlan,
    canUseCapability,
    checkQuota,
    isEnterprise: () => enterprise
  };
}

module.exports = { createPlatform, createTenants, createEntitlements, createAuthorization };
