'use strict';

function render(payload) {
  const { body, actions, meta } = payload;
  let replyMarkup = null;
  if (actions && actions.length) {
    replyMarkup = { keyboard: actions.map(a => [{ text: a.label.slice(0, 64) }]), resize_keyboard: true };
  }
  return {
    text: body.slice(0, 4096),
    replyMarkup,
    parseMode: meta.parseMode || null
  };
}

module.exports = { render };
