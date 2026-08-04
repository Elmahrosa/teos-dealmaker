// services/platform/authorization/index.js
// RBAC capability authorization. Roles ordered by level; each capability maps
// to a minimum role (explicit for known plugin capabilities, suffix-based
// default for read-only tools, otherwise operator). Per-workspace overrides
// may be applied in memory without schema changes.
'use strict';

const ROLES = ['viewer', 'analyst', 'operator', 'developer', 'admin', 'owner'];

const ROLE_LEVEL = {
  viewer: 1,
  analyst: 2,
  operator: 3,
  developer: 4,
  admin: 5,
  owner: 6
};

const CAPABILITY_MIN_ROLE = {
  'sentinel.scan': 'operator',
  'sentinel.audit': 'admin',
  'sentinel.policy.check': 'operator',
  'sentinel.rules.list': 'viewer',
  'sentinel.health': 'viewer',
  'civic.lookup': 'analyst',
  'civic.identity.verify': 'analyst',
  'civic.vote.create': 'operator',
  'civic.issue.create': 'operator',
  'civic.issue.list': 'analyst'
};

const READONLY_SUFFIXES = ['.list', '.health', '.read', '.get', '.status', '.discover'];

function defaultMinRole(capability) {
  if (READONLY_SUFFIXES.some((suffix) => String(capability || '').endsWith(suffix))) return 'viewer';
  return 'operator';
}

function minRoleFor(capability, overrides) {
  const explicit = overrides[capability] || CAPABILITY_MIN_ROLE[capability];
  return explicit || defaultMinRole(capability);
}

function createAuthorization(repos, opts) {
  const o = opts || {};
  const levels = o.roleLevels || ROLE_LEVEL;
  const roleOverrides = Object.assign({}, o.capabilityMinRole);
  const workspaceOverrides = new Map(o.workspaceOverrides ? Object.entries(o.workspaceOverrides) : []);

  function overrideKey(workspaceId, capability) {
    return `${workspaceId}:${capability}`;
  }

  async function authorize({ workspaceId, userId, role, capability, requester }) {
    if (!workspaceId) {
      return { allowed: false, reason: 'workspace_required', capability, requester: requester || null };
    }
    let resolvedRole = role;
    if (!resolvedRole && userId) {
      const member = await repos.members.get(workspaceId, userId);
      if (!member) {
        return { allowed: false, reason: 'not_workspace_member', workspaceId, userId, capability };
      }
      resolvedRole = member.role;
    }
    resolvedRole = resolvedRole || 'viewer';
    if (!levels[resolvedRole]) {
      return { allowed: false, reason: 'unknown_role', role: resolvedRole, workspaceId, capability };
    }
    const key = overrideKey(workspaceId, capability);
    if (workspaceOverrides.has(key)) {
      const override = workspaceOverrides.get(key);
      return {
        allowed: override.allowed,
        reason: override.allowed ? null : (override.reason || 'workspace_denied'),
        workspaceId,
        capability,
        role: resolvedRole,
        override: true
      };
    }
    const required = minRoleFor(capability, roleOverrides);
    if (levels[resolvedRole] < levels[required]) {
      return {
        allowed: false,
        reason: 'insufficient_role',
        workspaceId,
        userId: userId || null,
        capability,
        role: resolvedRole,
        required
      };
    }
    return { allowed: true, workspaceId, userId: userId || null, capability, role: resolvedRole, required };
  }

  function setOverride(workspaceId, capability, allowed, reason) {
    workspaceOverrides.set(overrideKey(workspaceId, capability), { allowed, reason: reason || null });
    return { ok: true, workspaceId, capability, allowed };
  }

  function clearOverride(workspaceId, capability) {
    const removed = workspaceOverrides.delete(overrideKey(workspaceId, capability));
    return { ok: removed };
  }

  return {
    authorize,
    setOverride,
    clearOverride,
    roles: ROLES,
    roleLevels: levels,
    minRoleFor: (capability) => minRoleFor(capability, roleOverrides)
  };
}

module.exports = { createAuthorization, ROLES, ROLE_LEVEL, CAPABILITY_MIN_ROLE, defaultMinRole, minRoleFor };
