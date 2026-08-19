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

  // Structured prospect data for ICP scoring and downstream processing
  const structuredData = {
    company: lead.company,
    domain: extractDomain(lead.website),
    contact: lead.contact_email || null,
    employeeCount: lead.employeeCount,
    industry: lead.industry,
    hasWebsite: lead.hasWebsite,
    budget: lead.budget || null,
    isDecisionMaker: lead.isDecisionMaker || false,
    hasClearNeed: lead.hasClearNeed || false,
    timelineInMonths: lead.timelineInMonths || null,
    painPoint: lead.pain_point || null,
    category: lead.category || null,
    source: lead.source || 'PROSPECTING_AGENT'
  };

  const result = {
    leadId: lead.id,
    company: lead.company,
    fitScore: score,
    classification,
    nextStep,
    reasons,
    structuredData: structuredData // For ICP qualification and deal creation
  };

  audit.writeEntry('PROSPECTING_AGENT_LEAD_SCORED', lead.id, classification, result);
  return result;
}

// Helper function to extract domain from website or email
function extractDomain(input) {
  if (!input) return null;

  const url = String(input).trim().toLowerCase();
  if (!url) return null;

  // Handle email addresses
  if (url.includes('@')) {
    const parts = url.split('@');
    if (parts.length === 2) return parts[1];
  }

  // Handle websites
  let domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '');
  domain = domain.split('/')[0]; // Remove path
  domain = domain.split(':')[0]; // Remove port

  return domain || null;
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
