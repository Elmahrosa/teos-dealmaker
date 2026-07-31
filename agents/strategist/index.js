const audit = require('../../utils/auditLogger');

function buildPlaybook(lead) {
  audit.writeEntry('STRATEGIST_AGENT_PLAYBOOK_STARTED', lead.id, 'in_progress', {
    leadId: lead.id,
    company: lead.company,
    classification: lead.classification,
    fitScore: lead.fitScore,
    budget: lead.budget
  });

  const score = lead.fitScore || 50;
  const budget = lead.budget || 0;
  const competitivePressure = lead.competitivePressure || 'low';

  let style = 'Value-Based';
  let rationale = [];

  if (score >= 75 && budget >= 10000) {
    style = 'Aggressive';
    rationale.push('High-fit, high-budget lead ready to close fast.');
  } else if (budget < 5000) {
    style = 'Penetration';
    rationale.push('Budget-constrained lead; enter with a low-risk starter offer.');
  } else if (competitivePressure === 'high') {
    style = 'Consultative';
    rationale.push('Competitive market; win on expertise and service.');
  } else {
    rationale.push('Balanced fit; position on measurable value and ROI.');
  }

  const phases = [
    { phase: 1, step: 'Discovery call to confirm priorities.' },
    { phase: 2, step: 'Present tailored proposal aligned to budget.' },
    { phase: 3, step: style === 'Aggressive' ? 'Push for signed commitment within 7 days.' : 'Grow scope after value is proven.' }
  ];

  const playbook = { style, rationale, phases };

  audit.writeEntry('STRATEGIST_AGENT_PLAYBOOK_COMPLETED', lead.id, 'success', {
    leadId: lead.id,
    company: lead.company,
    style,
    rationale,
    phases
  });

  return playbook;
}

module.exports = { buildPlaybook };
