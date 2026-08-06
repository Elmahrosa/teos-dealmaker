// plugins/civic-mixer/audit.js
// Plugin-side audit writer. Contract: exports a function or { write(...) }.
// In-memory by design — no filesystem writes at load or on the write path.
// Pre-execution audit evidence for every state-changing civic action, per the
// ICBC mandatory lifecycle ("immutable logging prior to execution").
'use strict';

const entries = [];

function write(event, actor, outcome, meta) {
  entries.push({ event, actor, outcome, meta: meta || null, at: new Date().toISOString() });
  return { ok: true, id: entries.length };
}

function list() {
  return entries.slice();
}

module.exports = { write, list };
