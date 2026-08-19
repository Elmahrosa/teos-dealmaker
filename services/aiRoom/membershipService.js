// services/aiRoom/membershipService.js
// Membership operations for TEOS AI Room
'use strict';
const audit = require('../../utils/auditLogger');

function createMembershipService(opts) {
  const { repos } = opts;

  async function add(params) {
    const {
      room_id,
      user_id,
      role = 'VIEWER'
    } = params;

    // Validate role
    const validRoles = ['VIEWER', 'MEMBER', 'ANALYST', 'OPERATOR', 'DEVELOPER', 'ADMIN', 'OWNER'];
    if (!validRoles.includes(role)) {
      throw new Error(`Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}`);
    }

    // Check if already a member
    const existing = await repos.roomMemberships.get(room_id, user_id);
    if (existing) {
      // If already a member, update the role instead of creating duplicate
      return await repos.roomMemberships.updateRole(room_id, user_id, role);
    }

    // Add membership
    const membership = await repos.roomMemberships.add({
      room_id,
      user_id,
      role
    });

    // Audit log
    await audit.writeEntry({
      action_type: 'ROOM_MEMBERSHIP_ADDED',
      details: {
        room_id,
        user_id,
        role
      }
    });

    return membership;
  }

  async function get(roomId, userId) {
    return await repos.roomMemberships.get(roomId, userId);
  }

  async function list(roomId, opts) {
    const o = opts || {};

    let result = await repos.roomMemberships.list(roomId);

    // Filter by user_id if provided
    if (o.user_id) {
      result = result.filter(m => m.user_id === o.user_id);
    }

    // Filter by role if provided
    if (o.role) {
      result = result.filter(m => m.role === o.role);
    }

    // Apply ordering
    const orderBy = o.orderBy || 'joined_at';
    const order = o.order || 'asc';
    result.sort((a, b) => {
      if (order === 'asc') {
        return a[orderBy] > b[orderBy] ? 1 : -1;
      } else {
        return a[orderBy] < b[orderBy] ? 1 : -1;
      }
    });

    // Apply pagination
    const limit = o.limit;
    const offset = o.offset || 0;
    if (limit) {
      result = result.slice(offset, offset + limit);
    }

    return result;
  }

  async function updateRole(roomId, userId, role) {
    // Validate role
    const validRoles = ['VIEWER', 'MEMBER', 'ANALYST', 'OPERATOR', 'DEVELOPER', 'ADMIN', 'OWNER'];
    if (!validRoles.includes(role)) {
      throw new Error(`Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}`);
    }

    // Get existing membership for audit details
    const existing = await repos.roomMemberships.get(roomId, userId);
    const oldRole = existing ? existing.role : null;

    const result = await repos.roomMemberships.updateRole(roomId, userId, role);

    // Audit log
    await audit.writeEntry({
      action_type: 'ROOM_MEMBERSHIP_ROLE_UPDATED',
      details: {
        room_id: roomId,
        user_id: userId,
        old_role: oldRole,
        new_role: role
      }
    });

    return result;
  }

  async function remove(roomId, userId) {
    // Get existing membership for audit details
    const existing = await repos.roomMemberships.get(roomId, userId);

    const result = await repos.roomMemberships.remove(roomId, userId);

    // Audit log (only if membership existed)
    if (existing) {
      await audit.writeEntry({
        action_type: 'ROOM_MEMBERSHIP_REMOVED',
        details: {
          room_id: roomId,
          user_id: userId,
          role: existing.role
        }
      });
    }

    return result;
  }

  async function listByUser(userId, opts) {
    const o = opts || {};

    let result = await repos.roomMemberships.listByUser(userId);

    // Filter by room_id if provided
    if (o.room_id) {
      result = result.filter(m => m.room_id === o.room_id);
    }

    // Filter by role if provided
    if (o.role) {
      result = result.filter(m => m.role === o.role);
    }

    // Apply ordering
    const orderBy = o.orderBy || 'joined_at';
    const order = o.order || 'asc';
    result.sort((a, b) => {
      if (order === 'asc') {
        return a[orderBy] > b[orderBy] ? 1 : -1;
      } else {
        return a[orderBy] < b[orderBy] ? 1 : -1;
      }
    });

    // Apply pagination
    const limit = o.limit;
    const offset = o.offset || 0;
    if (limit) {
      result = result.slice(offset, offset + limit);
    }

    return result;
  }

  return {
    add,
    get,
    list,
    updateRole,
    remove,
    listByUser
  };
}

module.exports = { createMembershipService };
