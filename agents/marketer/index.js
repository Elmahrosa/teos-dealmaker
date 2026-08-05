const audit = require('../../utils/auditLogger');

const HEADLINES = {
  Aggressive: 'Scale faster with an AI sales team that never sleeps.',
  Consultative: 'Your deals, guided by centuries of commercial strategy.',
  Penetration: 'Start small, scale big. Enterprise AI without the enterprise price.',
  'Value-Based': 'Turn AI into your most valuable commercial asset.'
};

function craftPositioning(lead, playbook) {
  audit.writeEntry('MARKETER_AGENT_POSITIONING_STARTED', lead.id, 'in_progress', {
    leadId: lead.id,
    company: lead.company,
    style: playbook.style
  });

  const headline = HEADLINES[playbook.style] || HEADLINES['Value-Based'];
  const tone = playbook.style === 'Aggressive' ? 'direct' : 'consultative';

  const valueProps = [
    'Multi-agent orchestration across the full deal lifecycle.',
    'Policy-governed safety for every action.',
    'Rule-based, deterministic behavior - no surprise spend.'
  ];

  const positioning = {
    headline,
    tone,
    valueProps,
    hook: `For ${lead.company}, ${playbook.style.toLowerCase()} motion: ${headline}`
  };

  audit.writeEntry('MARKETER_AGENT_POSITIONING_COMPLETED', lead.id, 'success', {
    leadId: lead.id,
    company: lead.company,
    headline,
    tone,
    valueProps
  });

  return positioning;
}

module.exports = { craftPositioning };
