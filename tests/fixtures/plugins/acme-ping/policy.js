'use strict';
module.exports = {
  rules: [
    (request) => (request.toolId === 'acme.ping' && request.payload && request.payload.halt
      ? { allowed: false, reason: 'fixture_hold' }
      : null)
  ]
};
