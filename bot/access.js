const { BOT_CONFIG } = require('./config');

function isFounder(userId) {
  return BOT_CONFIG.founderId !== null && userId === BOT_CONFIG.founderId;
}

function isAdmin(userId) {
  return BOT_CONFIG.adminIds.includes(userId) || isFounder(userId);
}

module.exports = { isFounder, isAdmin };
