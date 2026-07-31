const audit = require('../../utils/auditLogger');

const FLOOR_RATIO = 0.7;

function buildTerms(lead, targetPrice, budget) {
  audit.writeEntry('NEGOTIATOR_AGENT_TERMS_STARTED', lead.id, 'in_progress', {
    leadId: lead.id,
    company: lead.company,
    targetPrice,
    budget
  });

  const floorPrice = Math.round(targetPrice * FLOOR_RATIO * 100) / 100;

  let feasible = true;
  let landingPrice = floorPrice;

  if (budget < floorPrice) {
    feasible = false;
    landingPrice = budget;
  } else if (budget < targetPrice) {
    landingPrice = Math.round(budget * 100) / 100;
  }

  const maxDiscountPct = Math.round((1 - landingPrice / targetPrice) * 100);

  let suggestedTerms;
  if (targetPrice >= 20000) suggestedTerms = 'Net-30';
  else if (targetPrice >= 5000) suggestedTerms = 'Net-15';
  else suggestedTerms = 'Net-7';

  const offerLadder = feasible
    ? [targetPrice, Math.round(((targetPrice + landingPrice) / 2) * 100) / 100, landingPrice]
    : [targetPrice];

  const terms = {
    feasible,
    floorPrice,
    maxDiscountPct,
    landingPrice,
    offerLadder,
    suggestedTerms
  };

  audit.writeEntry('NEGOTIATOR_AGENT_TERMS_COMPLETED', lead.id, feasible ? 'success' : 'blocked', {
    leadId: lead.id,
    company: lead.company,
    feasible,
    maxDiscountPct,
    landingPrice,
    suggestedTerms
  });

  return terms;
}

module.exports = { buildTerms };
