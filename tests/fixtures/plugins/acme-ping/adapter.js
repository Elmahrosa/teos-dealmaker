'use strict';
module.exports = {
  calls: { initialized: 0, health: 0, shutdowns: 0 },
  config: () => ({ endpoint: 'https://acme.test/mcp' }),
  call: async (request) => ({ ok: true, data: `pong:${request.toolId}`, simulated: false }),
  health: async () => {
    module.exports.calls.health += 1;
    return { ok: true, status: 'ok' };
  },
  initialize: async () => {
    module.exports.calls.initialized += 1;
    return { ok: true };
  },
  shutdown: async () => {
    module.exports.calls.shutdowns += 1;
  }
};
