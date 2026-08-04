'use strict';
module.exports = {
  config: () => ({ endpoint: 'https://teal.test/mcp' }),
  call: async (request) => ({ ok: true, data: `pong:${request.toolId}`, simulated: false }),
  health: async () => ({ ok: true, status: 'ok' })
};
