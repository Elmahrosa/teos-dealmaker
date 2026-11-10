const { isDRY, isLIVE } = require('../config/mode');
const audit = require('../utils/auditLogger');

function route(message, destination) {
  if (isDRY()) {
    console.log('[ROUTE] DRY MODE — Message NOT sent');
    audit.writeEntry('ROUTE_DRY', destination, 'VAULTED', { message, mode: 'DRY' });
    return { status: 'VAULTED_DRY', message_id: message.id };
  }

  if (isLIVE()) {
    // No delivery transport is wired into this router. The message is prepared
    // and handed off as pending; delivery is never claimed without confirmation
    // from a real transport (see services/outboundWorker for the governed path).
    console.log('[ROUTE] LIVE MODE — Message prepared, pending delivery (no transport confirmation)');
    audit.writeEntry('ROUTE_LIVE', destination, 'PENDING_DELIVERY', { message, mode: 'LIVE', delivered: false });
    return { status: 'PENDING_DELIVERY', delivered: false, message_id: message.id };
  }
}

module.exports = { route };
