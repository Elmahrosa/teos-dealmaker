const { classify } = require('./classifier');
const { route } = require('./router');
const audit = require('../../utils/auditLogger');

function processResponse(response) {
  console.log(`[Qualification] Processing response from ${response.from}`);

  const classification = classify(response);
  console.log(`[Qualification] Sentiment: ${classification.sentiment}, Fit: ${classification.fit.label} (${classification.fit.score})`);
  audit.writeEntry('QUALIFICATION_AGENT_CLASSIFY', response.from, classification.sentiment, classification);

  const routing = route(classification);
  console.log(`[Qualification] Action: ${routing.action} -> ${routing.target_agent || 'archive'}`);
  audit.writeEntry('QUALIFICATION_AGENT_ROUTE', response.from, routing.action, routing);

  return { classification, routing };
}

function classifyLead(leadData, icpCriteria = DEFAULT_ICP_CRITERIA) {
  audit.writeEntry('QUALIFICATION_AGENT_START', 'lead_classification', 'in_progress', {
    leadId: leadData.id,
    company: leadData.company
  });

  let score = 0;
  const missingFields = [];

  // Use ICP criteria for scoring
  if (leadData.budget >= (icpCriteria.minBudget || 5000)) score += 25; else missingFields.push(`Budget below minimum (${icpCriteria.minBudget || 5000})`);
  if (leadData.isDecisionMaker) score += 25; else missingFields.push('Lacks authority');
  if (leadData.hasClearNeed) score += 25; else missingFields.push('Unclear business need');
  if (leadData.timelineInMonths <= (icpCriteria.maxTimelineMonths || 3)) score += 25; else missingFields.push(`Timeline too extended (>${icpCriteria.maxTimelineMonths || 3} months)`);

  // Additional ICP criteria
  if (icpCriteria.targetIndustries && icpCriteria.targetIndustries.length > 0) {
    if (icpCriteria.targetIndustries.includes(leadData.industry)) {
      score += 10;
    } else {
      missingFields.push(`Industry not in target list: ${leadData.industry}`);
    }
  }

  if (icpCriteria.minEmployeeCount && leadData.employeeCount >= icpCriteria.minEmployeeCount) {
    score += 10;
  } else if (icpCriteria.minEmployeeCount) {
    missingFields.push(`Employee count below minimum (${icpCriteria.minEmployeeCount})`);
  }

  if (icpCriteria.requiredTechnologies && icpCriteria.requiredTechnologies.length > 0) {
    const hasRequiredTech = icpCriteria.requiredTechnologies.some(tech =>
      leadData.technologies && leadData.technologies.includes(tech)
    );
    if (hasRequiredTech) {
      score += 5;
    } else {
      missingFields.push('Missing required technologies');
    }
  }

  let classification = 'DISQUALIFIED';
  let nextStep = 'ARCHIVE';
  if (score >= 75) {
    classification = 'SALES_READY';
    nextStep = 'ROUTE_TO_SALES';
  } else if (score >= 50) {
    classification = 'NURTURE';
    nextStep = 'ROUTE_TO_MARKETING';
  }

  const result = {
    leadId: leadData.id,
    classification: classification,
    score: score,
    missingCriteria: missingFields,
    nextStep: nextStep,
    icpScore: score,
    maxPossibleScore: 100
  };

  audit.writeEntry('QUALIFICATION_AGENT_COMPLETE', 'lead_classification', 'success', result);
  return result;
}

// Default ICP criteria for TEOS DealMaker
const DEFAULT_ICP_CRITERIA = {
  minBudget: 5000,
  maxTimelineMonths: 3,
  targetIndustries: ['Technology', 'Finance', 'Healthcare', 'Professional Services'],
  minEmployeeCount: 10,
  requiredTechnologies: [] // Can be configured per workspace
};

module.exports = { processResponse, classifyLead, DEFAULT_ICP_CRITERIA };
