const { BOT_CONFIG } = require('./config');

const FOUNDER_ROLES = ['founder', 'super_admin'];

// Founder status is granted if any of the following match:
//   telegram id == founder id, admin id in BOT_ADMIN_IDS, or a
//   founder / super_admin role on the workspace. Never payment-based.
function isFounder(userId, role) {
  if (BOT_CONFIG.founderId !== null && userId === BOT_CONFIG.founderId) return true;
  if (BOT_CONFIG.adminIds.includes(userId)) return true;
  if (role && FOUNDER_ROLES.includes(role)) return true;
  return false;
}

function isAdmin(userId, role) {
  if (isFounder(userId, role)) return true;
  if (BOT_CONFIG.adminIds.includes(userId)) return true;
  return false;
}

module.exports = { isFounder, isAdmin, FOUNDER_ROLES };
