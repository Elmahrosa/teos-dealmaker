const audit = require('../../utils/auditLogger');

function draftContract(deal) {
  audit.writeEntry('TREASURER_AGENT_CONTRACT_DRAFT_STARTED', deal.id, 'in_progress', {
    dealId: deal.id,
    company: deal.company,
    product: deal.product,
    amount: deal.amount
  });

  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const hasValidAmount = Number.isFinite(Number(deal.amount)) && Number(deal.amount) > 0;
  const contract = {
    contractId: `CONTRACT-${deal.id}-${stamp}`,
    company: deal.company,
    contactName: deal.contactName,
    product: deal.product,
    amount: hasValidAmount ? Number(deal.amount) : null,
    currency: deal.currency || null,
    termMonths: deal.termMonths || null,
    paymentMethod: deal.paymentMethod || null,
    effectiveDate: now.toISOString().slice(0, 10),
    monthlyPayment: hasValidAmount && deal.termMonths
      ? Math.round((Number(deal.amount) / Number(deal.termMonths)) * 100) / 100
      : null,
    status: hasValidAmount ? 'draft' : 'awaiting_verified_price',
    clauses: [
      'Scope of services as defined in the attached SOW.',
      'Payment terms require explicit agreement by both parties.',
      'Either party may terminate under the mutually agreed written terms.',
      'Governing law must be confirmed in the final agreement.'
    ]
  };

  audit.writeEntry('TREASURER_AGENT_CONTRACT_DRAFTED', contract.contractId, 'success', {
    contractId: contract.contractId,
    company: contract.company,
    amount: contract.amount,
    currency: contract.currency,
    status: contract.status
  });

  return contract;
}

// Payment-provider checkout is intentionally disabled until a new provider is approved.
async function createCheckout(deal, contract) {
  audit.writeEntry('TREASURER_AGENT_CHECKOUT_DISABLED', contract.contractId, 'pending', {
    dealId: deal.id,
    reason: 'No payment provider is configured or authorized.'
  });
  return null;
}

function closeDeal(deal, contract) {
  const summary = {
    dealId: deal.id,
    company: deal.company,
    contractId: contract.contractId,
    checkoutId: null,
    amount: contract.amount,
    currency: contract.currency,
    status: 'awaiting_customer',
    won: false,
    reason: 'Customer acceptance and verified payment evidence are required.'
  };

  audit.writeEntry('TREASURER_AGENT_AWAITING_CUSTOMER', deal.id, 'pending', summary);
  return summary;
}

async function runTreasuryFlow(deal) {
  const contract = draftContract(deal);
  const checkout = await createCheckout(deal, contract);
  return {
    ...closeDeal(deal, contract, checkout),
    contract,
    checkout
  };
}

module.exports = { draftContract, createCheckout, closeDeal, runTreasuryFlow };
