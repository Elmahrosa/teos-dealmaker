'use strict';

function render(payload) {
  const { body, actions } = payload;
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: body.slice(0, 3000) } }];
  if (actions && actions.length) {
    blocks.push({
      type: 'actions',
      elements: actions.slice(0, 5).map(a => ({ type: 'button', text: { type: 'plain_text', text: a.label.slice(0, 75) }, value: a.value }))
    });
  }
  return { text: body.slice(0, 3000), blocks };
}

module.exports = { render };
