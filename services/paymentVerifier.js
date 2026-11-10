'use strict';
// Payment / acceptance verifier interface (NOT implemented, no provider active).
//
// A deal may enter 'won' / 'closed' only through repos.deals.closeWon(), and
// closeWon() only succeeds when the repository was created with an injected
// verifier:
//
//   createRepos(adapter, { paymentVerifier })
//
// Production wiring passes no verifier, so closeWon() fails closed with
// PAYMENT_VERIFIER_UNAVAILABLE. Deals stay open / awaiting_customer.
//
// A verifier must establish the facts INDEPENDENTLY of the caller. It must not
// trust a `verified: true` flag, a provider reference string, or a founder
// assertion that the caller passes in. Examples of acceptable implementations:
// look the payment up at the provider by reference over an authenticated API,
// match a line in an imported bank statement ledger, or read a webhook event
// previously stored by a signature-verifying ingestion endpoint.
//
// Interface (both methods async, both return { ok: true, ...recordedFacts } or
// { ok: false, reason }):
//
//   verifyPayment({ deal, evidence })     -> {
//       ok, reference, source, amount, currency, recordedAt, recordedBy }
//   verifyAcceptance({ deal, acceptance }) -> {
//       ok, acceptedBy, acceptedAt, proofRef }
//
// closeWon() additionally requires the verified amount and currency to equal
// the deal's, and writes the verified facts (not the caller's) to the audit log.
const UNAVAILABLE = 'PAYMENT_VERIFIER_UNAVAILABLE';

function isVerifier(v) {
  return Boolean(v) && typeof v.verifyPayment === 'function' && typeof v.verifyAcceptance === 'function';
}

// Trusted server-side installation. A verifier is installed at most once, only
// during process boot, before any repository is used. The first read
// (getTrustedVerifier, called by createRepos) seals the slot: later installs
// throw, so request-handling code cannot swap or inject a verifier. No
// verifier is installed anywhere in this repository today; no provider is wired.
let installed = null;
let sealed = false;

function installTrustedVerifier(verifier) {
  if (sealed) throw new Error('payment_verifier_slot_sealed: install only during boot, before first repository use');
  if (installed) throw new Error('payment_verifier_already_installed');
  if (!isVerifier(verifier)) throw new Error('payment_verifier_invalid_interface');
  installed = Object.freeze(verifier);
}

function getTrustedVerifier() {
  sealed = true;
  return installed;
}

module.exports = { isVerifier, installTrustedVerifier, getTrustedVerifier, UNAVAILABLE };
