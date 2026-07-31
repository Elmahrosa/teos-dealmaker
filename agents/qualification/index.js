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

function classifyLead(leadData) {
  audit.writeEntry('QUALIFICATION_AGENT_START', 'lead_classification', 'in_progress', {
    leadId: leadData.id,
    company: leadData.company
  });

  let score = 0;
  const missingFields = [];

  if (leadData.budget >= 5000) score += 25; else missingFields.push('Budget below minimum');
  if (leadData.isDecisionMaker) score += 25; else missingFields.push('Lacks authority');
  if (leadData.hasClearNeed) score += 25; else missingFields.push('Unclear business need');
  if (leadData.timelineInMonths <= 3) score += 25; else missingFields.push('Timeline too extended');

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
    nextStep: nextStep
  };

  audit.writeEntry('QUALIFICATION_AGENT_COMPLETE', 'lead_classification', 'success', result);
  return result;
}

module.exports = { processResponse, classifyLead };
