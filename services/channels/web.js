'use strict';

function render(payload) {
  return { body: payload.body, actions: payload.actions, meta: payload.meta };
}

module.exports = { render };
