const audit = require('../../utils/auditLogger');

const HIGH_VALUE_INDUSTRIES = ['Technology', 'Finance', 'Healthcare'];

function scoreLead(lead) {
  audit.writeEntry('PROSPECTING_AGENT_ANALYSIS_STARTED', lead.id, 'in_progress', {
    leadId: lead.id,
    company: lead.company,
    industry: lead.industry,
    employeeCount: lead.employeeCount
  });

  let score = 50;
  let reasons = [];

  if (HIGH_VALUE_INDUSTRIES.includes(lead.industry)) {
    score += 25;
    reasons.push('High-value industry.');
  }

  if (lead.employeeCount > 100) {
    score += 20;
    reasons.push('Enterprise scale; budget capacity.');
  } else if (lead.employeeCount >= 50) {
    score += 10;
    reasons.push('Mid-market scale.');
  } else {
    score -= 5;
    reasons.push('Small team; possible budget constraints.');
  }

  if (lead.hasWebsite) {
    score += 5;
    reasons.push('Established web presence.');
  }

  let classification;
  if (score >= 75) classification = 'Hot';
  else if (score >= 50) classification = 'Warm';
  else classification = 'Cold';

  let nextStep;
  if (classification === 'Hot') nextStep = 'qualification';
  else if (classification === 'Warm') nextStep = 'follow_up';
  else nextStep = 'archive';

  const result = {
    leadId: lead.id,
    company: lead.company,
    fitScore: score,
    classification,
    nextStep,
    reasons
  };

  audit.writeEntry('PROSPECTING_AGENT_LEAD_SCORED', lead.id, classification, result);
  return result;
}

function runProspectingCycle(leads) {
  const results = leads.map(scoreLead);

  const summary = {
    total: results.length,
    hot: results.filter(r => r.classification === 'Hot').length,
    warm: results.filter(r => r.classification === 'Warm').length,
    cold: results.filter(r => r.classification === 'Cold').length
  };

  audit.writeEntry('PROSPECTING_AGENT_CYCLE_COMPLETED', 'batch', 'success', summary);
  return { results, summary };
}

module.exports = { scoreLead, runProspectingCycle };
