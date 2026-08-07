'use strict';

function sanitize(input) {
  return String(input == null ? '' : input)
    .split('')
    .filter(ch => {
      const c = ch.charCodeAt(0);
      return c >= 0x20 && c !== 0x7f;
    })
    .join('')
    .trim();
}

function make(body, { actions = [], meta = {} } = {}) {
  const cleaned = sanitize(body);
  return {
    body: cleaned,
    actions: Array.isArray(actions)
      ? actions.map(a => (typeof a === 'string' ? { label: sanitize(a), value: a } : { label: sanitize(a.label), value: sanitize(a.value ?? a.label) }))
      : [],
    meta
  };
}

module.exports = { make, sanitize };
