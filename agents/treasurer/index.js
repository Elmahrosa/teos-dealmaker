const audit = require('../../utils/auditLogger');
const mode = require('../../config/mode');

function draftContract(deal) {
  audit.writeEntry('TREASURER_AGENT_CONTRACT_DRAFT_STARTED', deal.id, 'in_progress', {
    dealId: deal.id,
    company: deal.company,
    product: deal.product,
    amount: deal.amount
  });

  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const contract = {
    contractId: `CONTRACT-${deal.id}-${stamp}`,
    company: deal.company,
    contactName: deal.contactName,
    product: deal.product,
    amount: deal.amount,
    currency: deal.currency || 'USD',
    termMonths: deal.termMonths || 12,
    paymentMethod: deal.paymentMethod || 'invoice',
    effectiveDate: now.toISOString().slice(0, 10),
    monthlyPayment: Math.round(((deal.amount || 0) / (deal.termMonths || 12)) * 100) / 100,
    clauses: [
      'Scope of services as defined in the attached SOW.',
      'Payment due within 30 days of invoice.',
      'Either party may terminate with 30 days written notice.',
      'Governing law: Egypt.'
    ]
  };

  audit.writeEntry('TREASURER_AGENT_CONTRACT_DRAFTED', contract.contractId, 'success', {
    contractId: contract.contractId,
    company: contract.company,
    amount: contract.amount,
    currency: contract.currency,
    termMonths: contract.termMonths,
    paymentMethod: contract.paymentMethod
  });

  return contract;
}

function createCheckout(deal, contract) {
  if (!mode.isDRY()) {
    audit.writeEntry('TREASURER_AGENT_CHECKOUT_BLOCKED', contract.contractId, 'blocked', {
      reason: 'Dodo Payments is DRY-only until LIVE payments are enabled',
      mode: mode.getMode()
    });
    return null;
  }

  const checkout = {
    checkoutId: `CHK-${contract.contractId}`,
    amount: contract.amount,
    currency: contract.currency,
    paymentMethod: contract.paymentMethod,
    url: `https://dodo.example/checkout/${contract.contractId}`,
    dryRun: true
  };

  audit.writeEntry('TREASURER_AGENT_CHECKOUT_CREATED', checkout.checkoutId, 'dry_run', checkout);
  return checkout;
}

function closeDeal(deal, contract, checkout) {
  const summary = {
    dealId: deal.id,
    company: deal.company,
    contractId: contract.contractId,
    checkoutId: checkout ? checkout.checkoutId : null,
    amount: contract.amount,
    currency: contract.currency,
    status: 'closed'
  };

  audit.writeEntry('TREASURER_AGENT_DEAL_CLOSED', deal.id, 'success', summary);
  return summary;
}

function runTreasuryFlow(deal) {
  const contract = draftContract(deal);
  const checkout = createCheckout(deal, contract);
  return closeDeal(deal, contract, checkout);
}

module.exports = { draftContract, createCheckout, closeDeal, runTreasuryFlow };
