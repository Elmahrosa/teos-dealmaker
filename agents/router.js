const { isDRY, isLIVE } = require('../config/mode');
const audit = require('../utils/auditLogger');

function route(message, destination) {
  if (isDRY()) {
    console.log('[ROUTE] DRY MODE — Message NOT sent');
    audit.writeEntry('ROUTE_DRY', destination, 'VAULTED', { message, mode: 'DRY' });
    return { status: 'VAULTED_DRY', message_id: message.id };
  }

  if (isLIVE()) {
    console.log('[ROUTE] LIVE MODE — Sending message');
    audit.writeEntry('ROUTE_LIVE', destination, 'SENT', { message, mode: 'LIVE' });
    return { status: 'SENT', message_id: message.id };
  }
}

module.exports = { route };
