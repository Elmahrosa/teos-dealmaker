'use strict';

const payload = require('./payload');
const telegram = require('./telegram');
const email = require('./email');
const slack = require('./slack');
const whatsapp = require('./whatsapp');
const web = require('./web');

const RENDERERS = { telegram, email, slack, whatsapp, web };

function render(channel, p) {
  const adapter = RENDERERS[channel];
  if (!adapter) throw new Error(`unsupported channel: ${channel}`);
  return adapter.render(p);
}

module.exports = { render, make: payload.make, payload, RENDERERS };
