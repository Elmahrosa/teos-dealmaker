'use strict';
const assert = require('assert');
const { closeDeal } = require('../agents/closing');

const base = {
  id: 'deal_001', company: 'Nexus AI', amount: 8750, currency: 'USD',
  contractId: 'CONTRACT-deal_001-20260731', approved: true, paymentMethod: 'invoice'
};
const acceptance = { accepted: true, acceptedBy: 'layla@example.com', acceptedAt: '2026-07-31T10:00:00Z', proofRef: 'signed-CONTRACT-deal_001' };
const payment = { verified: true, reference: 'bank-ref-0001', source: 'bank_statement', recordedBy: 'founder:7700001', recordedAt: '2026-08-01T10:00:00Z', amount: 8750, currency: 'USD' };
const founderReceipt = { ...payment, source: 'founder_confirmed_receipt', receiptDocument: 'receipts/2026-08/rcpt-0001.pdf', confirmedBy: 'founder:7700001' };

// Internal approval + contract + invoice is NOT a win.
let r = closeDeal(base);
assert.strictEqual(r.status, 'awaiting_customer');
assert.strictEqual(r.won, false);
assert.deepStrictEqual(r.awaiting, ['customer acceptance', 'verified payment evidence']);

// Acceptance alone is not enough.
r = closeDeal({ ...base, customerAcceptance: acceptance });
assert.strictEqual(r.status, 'awaiting_customer');
assert.deepStrictEqual(r.awaiting, ['verified payment evidence']);

// Payment alone is not enough.
r = closeDeal({ ...base, paymentEvidence: payment });
assert.strictEqual(r.status, 'awaiting_customer');

// Self-asserted / untrusted evidence is rejected.
r = closeDeal({ ...base, customerAcceptance: acceptance, paymentEvidence: { verified: true, reference: 'x', source: 'agent' } });
assert.strictEqual(r.status, 'awaiting_customer');
r = closeDeal({ ...base, customerAcceptance: acceptance, paymentEvidence: { verified: false, reference: 'x', source: 'bank_statement' } });
assert.strictEqual(r.status, 'awaiting_customer');

// Bare flags / fabricated shapes are rejected.
for (const bad of [
  { verified: true, reference: 'x', source: 'bank_statement' },
  { ...payment, recordedBy: '' },
  { ...payment, recordedAt: '2999-01-01T00:00:00Z' },
  { ...payment, amount: 1 },
  { ...payment, currency: 'EUR' },
  { ...payment, amount: undefined },
  { verified: true, reference: 'bank-ref-0001', source: 'founder_confirmed_receipt', recordedBy: 'f', recordedAt: '2026-08-01T10:00:00Z', amount: 8750, currency: 'USD' },
  { ...founderReceipt, receiptDocument: '' },
  { ...founderReceipt, confirmedBy: '' }
]) {
  assert.strictEqual(closeDeal({ ...base, customerAcceptance: acceptance, paymentEvidence: bad }).status, 'awaiting_customer', JSON.stringify(bad));
}
for (const badAcc of [
  { accepted: true, acceptedBy: 'a@b.c', acceptedAt: '2026-07-31T10:00:00Z' },
  { accepted: true, acceptedBy: 'a@b.c', acceptedAt: 'not-a-date', proofRef: 'p-123' },
  { accepted: 'yes', acceptedBy: 'a@b.c', acceptedAt: '2026-07-31T10:00:00Z', proofRef: 'p-123' }
]) {
  assert.strictEqual(closeDeal({ ...base, customerAcceptance: badAcc, paymentEvidence: payment }).status, 'awaiting_customer');
}

// Even complete, well-formed claims never win here: the closing agent has no
// independent verifier, so the deal stays awaiting_customer (won is only
// reachable through repos.deals.closeWon with an injected verifier).
for (const ev of [payment, founderReceipt, { ...payment, verified: true, source: 'provider_webhook', reference: 'pi_fabricated_123' }]) {
  r = closeDeal({ ...base, customerAcceptance: acceptance, paymentEvidence: ev });
  assert.strictEqual(r.status, 'awaiting_customer');
  assert.strictEqual(r.won, false);
  assert.ok(r.awaiting.includes('independent verification of acceptance and payment'));
}

// Missing basics -> blocked.
r = closeDeal({ id: 'deal_002', company: 'Local Bakery', amount: 2000 });
assert.strictEqual(r.status, 'blocked');
assert.ok(r.missing.includes('contract'));

console.log('PASS: closing agent never wins on caller-supplied evidence (bad claims rejected, good claims stay awaiting_customer)');
