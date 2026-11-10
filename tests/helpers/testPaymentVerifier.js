'use strict';
// TEST-ONLY verifier. It is injected explicitly into createRepos() by tests and
// is never required by production code. It "independently" confirms only
// evidence that the test registered in its own ledger, so a caller-supplied
// `verified: true` object that is not in the ledger is rejected.
function createTestPaymentVerifier() {
  const payments = new Map();
  const acceptances = new Map();
  return {
    recordPayment(fact) { payments.set(fact.reference, fact); },
    recordAcceptance(fact) { acceptances.set(fact.proofRef, fact); },
    async verifyPayment({ evidence }) {
      const f = evidence && payments.get(evidence.reference);
      return f ? { ok: true, ...f, verified: true } : { ok: false, reason: 'not_in_ledger' };
    },
    async verifyAcceptance({ acceptance }) {
      const f = acceptance && acceptances.get(acceptance.proofRef);
      return f ? { ok: true, ...f } : { ok: false, reason: 'not_in_ledger' };
    }
  };
}

// Build a ledger-backed evidence pair for a deal.
function evidenceFor(verifier, { amount, currency = 'USD', tag = 'x' }) {
  const now = new Date().toISOString();
  const acc = { accepted: true, acceptedBy: 'buyer@example.com', acceptedAt: now, proofRef: `signed-contract-${tag}` };
  const pay = { verified: true, reference: `bank-ref-${tag}`, source: 'bank_statement', recordedBy: 'ledger:test', recordedAt: now, amount, currency };
  verifier.recordAcceptance(acc);
  verifier.recordPayment(pay);
  return { customerAcceptance: acc, paymentEvidence: pay };
}

module.exports = { createTestPaymentVerifier, evidenceFor };
