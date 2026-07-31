const audit = require('../../utils/auditLogger');

function closeDeal(deal) {
  audit.writeEntry('CLOSING_AGENT_CLOSE_STARTED', deal.id, 'in_progress', {
    dealId: deal.id,
    company: deal.company,
    amount: deal.amount,
    contractId: deal.contractId,
    approved: deal.approved,
    paymentMethod: deal.paymentMethod
  });

  const missing = [];
  if (!deal.contractId) missing.push('contract');
  if (!deal.approved) missing.push('gatekeeper approval');
  if (!deal.paymentMethod) missing.push('payment method');
  if (!deal.amount) missing.push('amount');

  let result;

  if (missing.length === 0) {
    result = {
      dealId: deal.id,
      company: deal.company,
      amount: deal.amount,
      currency: deal.currency || 'USD',
      status: 'won',
      closedAt: new Date().toISOString(),
      nextSteps: ['Notify stakeholders', 'Archive deal record', 'Schedule onboarding']
    };

    audit.writeEntry('CLOSING_AGENT_DEAL_CLOSED', deal.id, 'won', {
      dealId: deal.id,
      company: deal.company,
      amount: deal.amount,
      currency: result.currency,
      closedAt: result.closedAt
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

module.exports = { closeDeal };
