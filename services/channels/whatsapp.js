'use strict';

function render(payload) {
  const { body } = payload;
  return { text: body.slice(0, 4096) };
}

module.exports = { render };
