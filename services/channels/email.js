'use strict';

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render(payload) {
  const { body, meta } = payload;
  return {
    subject: meta.subject || 'TEOS DealMaker update',
    text: body,
    html: `<p>${escapeHtml(body).replace(/\n/g, '<br/>')}</p>`
  };
}

module.exports = { render, escapeHtml };
