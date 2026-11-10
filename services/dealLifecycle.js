'use strict';
// Lifecycle rules enforced at the repository boundary (db/repos.js).

const TERMINAL_STAGES = ['won', 'closed'];
const TERMINAL_STATUSES = ['won', 'closed'];

// Customer #0 (the founder's own first deal) is never a won/closed deal.
const PROTECTED_COMPANIES = ['Elmahrosa International'];

function isTerminalChange(changes) {
  if (!changes) return false;
  const stage = changes.stage == null ? null : String(changes.stage).toLowerCase();
  const status = changes.status == null ? null : String(changes.status).toLowerCase();
  return TERMINAL_STAGES.includes(stage) || TERMINAL_STATUSES.includes(status);
}

function lifecycleError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function assertNotTerminal(changes) {
  if (isTerminalChange(changes)) {
    throw lifecycleError('WON_NOT_VERIFIED', 'won_or_closed_requires_deals.closeWon_with_verified_evidence');
  }
}

// Capability that lets db/repos.js closeWon() write a terminal state through the
// adapter guard. It is module-private (never exported from the package index);
// raw adapter callers that do not hold it are refused. In-process code can still
// require this file, so this is a guard rail against accidental/unreviewed
// writes, not a security boundary against code already running in the process.
const WIN_CAPABILITY = Symbol('teos.deals.win');

// External systems (CRM connectors) report their own notion of won/closed.
// That is a claim, not a verified win: keep the deal open at 'closing'.
function sanitizeExternalDeal(d) {
  const stage = String(d.stage || '').toLowerCase();
  const status = String(d.status || '').toLowerCase();
  const terminal = TERMINAL_STAGES.includes(stage) || TERMINAL_STATUSES.includes(status);
  return terminal ? { ...d, stage: 'closing', status: 'open', externalTerminalClaim: true } : { ...d, externalTerminalClaim: false };
}

module.exports = { WIN_CAPABILITY, sanitizeExternalDeal, TERMINAL_STAGES, TERMINAL_STATUSES, PROTECTED_COMPANIES, isTerminalChange, assertNotTerminal, lifecycleError };
