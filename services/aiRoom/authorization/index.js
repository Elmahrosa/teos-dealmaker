// services/aiRoom/authorization/index.js
// Authorization for TEOS AI Room operations
'use strict';

const ROLES = ['viewer', 'member', 'admin', 'owner'];

const ROLE_LEVEL = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4
};

// Default minimum role for capabilities if not explicitly defined
function defaultMinRole(capability) {
  // Read-only operations default to viewer
  const READONLY_SUFFIXES = ['.list', '.health', '.read', '.get', '.status', '.discover'];
  if (READONLY_SUFFIXES.some((suffix) => String(capability || '').endsWith(suffix))) return 'viewer';
  return 'member';
}

// Get minimum role for a capability, considering overrides
function minRoleFor(capability, roleOverrides) {
  const explicit = roleOverrides[capability];
  return explicit || defaultMinRole(capability);
}

function createAuthorization(repos, opts) {
  const o = opts || {};
  const platformAuthorization = o.platformAuthorization; // Reuse platform auth for workspace checks
  const levels = o.roleLevels || ROLE_LEVEL;
  const roleOverrides = Object.assign({}, o.capabilityMinRole);
  const workspaceOverrides = new Map(o.workspaceOverrides ? Object.entries(o.workspaceOverrides) : []);

  function overrideKey(workspaceId, capability) {
    return `${workspaceId}:${capability}`;
  }

  // Core authorization function for room access
  async function authorizeRoomAccess({ workspaceId, userId, roomId, requiredRole, requester }) {
    // First, validate workspace access using platform authorization (if available)
    if (platformAuthorization) {
      const workspaceAuth = await platformAuthorization.authorize({ workspaceId, userId, capability: 'rooms.access', requester });
      if (!workspaceAuth.allowed) {
        return { allowed: false, reason: workspaceAuth.reason, workspaceId, userId, capability: 'rooms.access', requester: requester || null };
      }
    }

    // If no userId, we cannot check room membership
    if (!userId) {
      return { allowed: false, reason: 'user_required', workspaceId, roomId, capability: 'rooms.access' };
    }

    // Check if user is a member of the room
    const membership = await repos.roomMemberships.get(roomId, userId);
    if (!membership) {
      return { allowed: false, reason: 'not_room_member', workspaceId, roomId, userId, capability: 'rooms.access' };
    }

    // Normalize role to lowercase for consistent comparison, handling null/undefined and trimming whitespace
    let userRole = '';
    if (membership.role != null) {
      userRole = String(membership.role).trim().toLowerCase();
    }
    const normalizedRequiredRole = requiredRole ? String(requiredRole).trim().toLowerCase() : '';

    // Check if user's role meets or exceeds required role
    const userRoleLevel = levels[userRole];
    const requiredRoleLevel = levels[normalizedRequiredRole];
    if (userRoleLevel === undefined) {
      return { allowed: false, reason: 'invalid_user_role', workspaceId, roomId, userId, capability: 'rooms.access', role: membership.role };
    }
    if (requiredRoleLevel === undefined) {
      return { allowed: false, reason: 'invalid_required_role', workspaceId, roomId, userId, capability: 'rooms.access', role: membership.role, required: requiredRole };
    }
    if (userRoleLevel < requiredRoleLevel) {
      return { allowed: false, reason: 'insufficient_role', workspaceId, roomId, userId, capability: 'rooms.access', role: membership.role, required: requiredRole };
    }

    // Apply workspace-specific overrides if any
    const key = overrideKey(workspaceId, `rooms.${normalizedRequiredRole}`);
    if (workspaceOverrides.has(key)) {
      const override = workspaceOverrides.get(key);
      return {
        allowed: override.allowed,
        reason: override.allowed ? null : (override.reason || 'workspace_denied'),
        workspaceId,
        roomId,
        userId,
        capability: 'rooms.access',
        role: membership.role,
        required: requiredRole,
        override: true
      };
    }

    return { allowed: true, workspaceId, roomId, userId, capability: 'rooms.access', role: membership.role, required: requiredRole };
  }

  // Authorization for document access (view/download)
  async function authorizeDocumentAccess({ workspaceId, userId, roomId, documentId, permission }) {
    // Permission: VIEW or DOWNLOAD
    // First check room access (at least viewer role needed to see documents)
    const roomAuth = await authorizeRoomAccess({ workspaceId, userId, roomId, requiredRole: 'VIEWER', requester: null });
    if (!roomAuth.allowed) {
      return { allowed: false, reason: roomAuth.reason, workspaceId, roomId, userId, documentId, capability: `document.${permission}` };
    }

    // For DOWNLOAD, we might require a higher role (e.g., MEMBER) but we'll use the same as VIEW for now
    // In future, we could differentiate based on permission type
    return { allowed: true, workspaceId, roomId, userId, documentId, capability: `document.${permission}` };
  }

  // Authorization for creating shares
  async function authorizeShareCreation({ workspaceId, userId, roomId }) {
    // At least member role required to create shares
    return await authorizeRoomAccess({ workspaceId, userId, roomId, requiredRole: 'MEMBER', requester: null });
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
    authorizeRoomAccess,
    authorizeDocumentAccess,
    authorizeShareCreation,
    setOverride,
    clearOverride,
    roles: ROLES,
    roleLevels: levels,
    minRoleFor: (capability) => minRoleFor(capability, roleOverrides)
  };
}

module.exports = { createAuthorization, ROLES, ROLE_LEVEL };
