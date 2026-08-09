const audit = require('../../utils/auditLogger');
const dealSimulationSvc = require('../../services/dealSimulation');

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
    suggestedTerms,
    offerLadder
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

/**
 * Build terms enhanced with simulation data
 * @param {Object} lead - Lead information
 * @param {number} targetPrice - Target price
 * @param {number} budget - Customer budget
 * @param {Object} adapter - Database adapter
 * @param {number} workspaceId - Workspace ID
 * @param {number} dealId - Deal ID (optional)
 * @returns {Promise<Object>} Enhanced terms
 */
async function buildTermsWithSimulation(lead, targetPrice, budget, adapter, workspaceId, dealId) {
  // Start with base terms
  const baseTerms = buildTerms(lead, targetPrice, budget);

  // If no deal ID provided, return base terms
  if (!dealId) {
    return baseTerms;
  }

  try {
      // Get stakeholder intelligence to inform terms
      const stakeholderIntel = await dealSimulationSvc.buildStakeholderIntelligence(
          adapter, workspaceId, dealId
      );

      // Adjust terms based on stakeholder intelligence
      const enhancedTerms = { ...baseTerms };

      // If stakeholders show high price sensitivity, adjust floor price
      const priceSensitiveStakeholders = stakeholderIntel.stakeholders
          .filter(s => s.role.toLowerCase().includes('cfo') ||
                       s.role.toLowerCase().includes('finance') ||
                       s.role.toLowerCase().includes('procurement'))
          .length;

      if (priceSensitiveStakeholders > 0 && stakeholderIntel.confidence > 0.7) {
          // Increase flexibility in pricing
          const flexibilityFactor = 0.1 * (priceSensitiveStakeholders / stakeholderIntel.stakeholders.length);
          const adjustedFloor = Math.round(targetPrice * (FLOOR_RATIO - flexibilityFactor) * 100) / 100;

          if (budget < adjustedFloor) {
              enhancedTerms.feasible = false;
              enhancedTerms.landingPrice = budget;
          } else if (budget < targetPrice) {
              enhancedTerms.landingPrice = Math.round(budget * 100) / 100;
          } else {
              enhancedTerms.landingPrice = adjustedFloor;
          }

          enhancedTerms.floorPrice = adjustedFloor;
          enhancedTerms.maxDiscountPct = Math.round((1 - enhancedTerms.landingPrice / targetPrice) * 100);
          enhancedTerms.offerLadder = enhancedTerms.feasible
              ? [targetPrice, Math.round(((targetPrice + enhancedTerms.landingPrice) / 2) * 100) / 100, enhancedTerms.landingPrice]
              : [targetPrice];
      }

      // Adjust suggested terms based on decision timeline from stakeholders
      const timelineStakeholders = stakeholderIntel.stakeholders
          .filter(s => s.role.toLowerCase().includes('legal') ||
                       s.role.toLowerCase().includes('operations'))
          .length;

      if (timelineStakeholders > 0) {
          // Suggest shorter payment terms for faster decision
          if (targetPrice >= 10000) {
              enhancedTerms.suggestedTerms = 'Net-15'; // More favorable terms
          }
      }

      audit.writeEntry('NEGOTIATOR_AGENT_TERMS_ENHANCED', lead.id, 'success', {
          leadId: lead.id,
          company: lead.company,
          targetPrice: targetPrice,
          budget: budget,
          stakeholderConfidence: stakeholderIntel.confidence,
          stakeholderCount: stakeholderIntel.stakeholders.length
      });

      return enhancedTerms;
  } catch (error) {
      console.error('[Negotiator] Error enhancing terms with simulation:', error);
      // Fall back to base terms on error
      return baseTerms;
  }
}

module.exports = { buildTerms, buildTermsWithSimulation };