const audit = require('../../utils/auditLogger');

const TRUSTED_PAYMENT_SOURCES = ['provider_webhook', 'bank_statement', 'founder_confirmed_receipt'];

const nonEmpty = v => typeof v === 'string' && v.trim().length >= 3;
const validPastDate = v => {
  const t = Date.parse(v);
  return Number.isFinite(t) && t <= Date.now() + 5 * 60 * 1000;
};

// Explicit customer acceptance must name who accepted, when, and carry a proof
// reference (signed contract id, email message id, ...). A bare boolean fails.
function verifiedAcceptance(a) {
  return a && a.accepted === true && nonEmpty(a.acceptedBy) && validPastDate(a.acceptedAt) && nonEmpty(a.proofRef)
    ? a : null;
}

// Payment evidence is a recorded artifact, not a flag. It must come from a
// trusted source, carry a reference, who recorded it and when, and (when the
// deal is supplied) match the deal amount and currency. A founder-confirmed
// receipt additionally needs the receipt document/transaction id and the
// confirming founder, so a button press or `verified: true` is never enough.
function verifiedPayment(p, deal) {
  if (!p || p.verified !== true) return null;
  if (!TRUSTED_PAYMENT_SOURCES.includes(p.source)) return null;
  if (!nonEmpty(p.reference) || !nonEmpty(p.recordedBy) || !validPastDate(p.recordedAt)) return null;
  if (!(Number(p.amount) > 0) || !nonEmpty(p.currency)) return null;
  if (p.source === 'founder_confirmed_receipt' && (!nonEmpty(p.receiptDocument) || !nonEmpty(p.confirmedBy))) return null;
  if (deal) {
    const expected = Number(deal.amount);
    if (!(expected > 0) || Number(p.amount) !== expected) return null;
    if (String(p.currency).toUpperCase() !== String(deal.currency || 'USD').toUpperCase()) return null;
  }
  return p;
}

function closeDeal(deal) {
  audit.writeEntry('CLOSING_AGENT_CLOSE_STARTED', deal.id, 'in_progress', {
    dealId: deal.id,
    company: deal.company,
    amount: deal.amount,
    contractId: deal.contractId,
    approved: deal.approved,
    paymentMethod: deal.paymentMethod
  });

  const acceptance = verifiedAcceptance(deal.customerAcceptance);
  const payment = verifiedPayment(deal.paymentEvidence, deal);

  const missing = [];
  if (!deal.contractId) missing.push('contract');
  if (!deal.approved) missing.push('gatekeeper approval');
  if (!deal.amount) missing.push('amount');

  // This agent NEVER marks a deal won. Caller-supplied acceptance/payment
  // objects (even well-formed, even `verified: true`, even a founder assertion)
  // are claims, not proof. Only repos.deals.closeWon(), with an injected
  // independent verifier (services/paymentVerifier.js), can win a deal, and no
  // such verifier is configured in production. The deal stays awaiting_customer.
  const awaiting = [];
  if (!acceptance) awaiting.push('customer acceptance');
  if (!payment) awaiting.push('verified payment evidence');
  if (awaiting.length === 0) awaiting.push('independent verification of acceptance and payment');

  let result;

  if (missing.length === 0) {
    result = {
      dealId: deal.id,
      company: deal.company,
      amount: deal.amount,
      currency: deal.currency || 'USD',
      status: 'awaiting_customer',
      won: false,
      awaiting,
      claimed: Boolean(acceptance && payment)
    };
    audit.writeEntry('CLOSING_AGENT_AWAITING_CUSTOMER', deal.id, 'pending', {
      dealId: deal.id,
      company: deal.company,
      awaiting,
      claimed: result.claimed
    });
  } else {
    result = {
      dealId: deal.id,
      company: deal.company,
      status: 'blocked',
      missing
    };

    audit.writeEntry('CLOSING_AGENT_DEAL_BLOCKED', deal.id, 'blocked', {
      dealId: deal.id,
      company: deal.company,
      missing
    });
  }

  return result;
}

module.exports = { closeDeal, verifiedAcceptance, verifiedPayment, TRUSTED_PAYMENT_SOURCES };
