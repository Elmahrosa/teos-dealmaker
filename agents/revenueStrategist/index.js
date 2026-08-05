const SPECIALISTS = {
  intelligence: { label: 'Researcher (market_intelligence)', role: 'Industry and prospect research' },
  prospecting: { label: 'Prospector (prospecting)', role: 'Find and score target accounts' },
  strategist: { label: 'Strategist (strategist)', role: 'Tactical playbook and positioning' },
  outreach: { label: 'Outreach (outreach)', role: 'Draft and dispatch emails' },
  marketer: { label: 'Marketer (marketer)', role: 'Position value for every touchpoint' },
  negotiator: { label: 'Negotiator (negotiator)', role: 'Terms, thresholds and pricing' },
  treasurer: { label: 'Treasurer (treasurer)', role: 'Contracts and checkout' },
  gatekeeper: { label: 'Gatekeeper (gatekeeper)', role: 'Review drafts for safety' },
  closing: { label: 'Closer (closing)', role: 'Close or block the deal' }
};

function evaluateMission(goal, knowledge) {
  const company = (knowledge && knowledge.company) || {};
  const products = (knowledge && knowledge.products) || [];
  const personas = (knowledge && knowledge.personas) || [];
  const hasKnowledge = Boolean(company.company_name || company.products || products.length || personas.length);

  const reasoning = [];
  const successCriteria = [
    'A clear success criterion per mission goal',
    'Costs stay within the approved budget',
    'Any irreversible action (send, contract, payment) gets founder approval first'
  ];
  const specialists = [];
  let budgetCents = 500;

  if (hasKnowledge) {
    reasoning.push(`Grounded in company knowledge for ${company.company_name || 'this workspace'} (${products.length} products, ${personas.length} personas).`);
    budgetCents = Math.min(2500, 500 + products.length * 200 + personas.length * 100);
  } else {
    reasoning.push('No company knowledge found yet. Recommend the founder complete Mission #0 (learn-first onboarding) before starting this mission.');
    budgetCents = 200;
  }

  if (/research|intelligence|competitor|market/i.test(goal)) {
    specialists.push(SPECIALISTS.intelligence, SPECIALISTS.prospecting);
    successCriteria.push('At least 3 researched target accounts or competitor insights delivered.');
  }
  if (/pipeline|prospect|lead|outbound|outreach|email/i.test(goal)) {
    specialists.push(SPECIALISTS.prospecting, SPECIALISTS.outreach);
    successCriteria.push('A prioritized target account list with outreach drafts, gated on founder approval.');
  }
  if (/proposal|position|pricing|strategy|package/i.test(goal)) {
    specialists.push(SPECIALISTS.strategist, SPECIALISTS.marketer, SPECIALISTS.negotiator);
    successCriteria.push('A positioning statement, pricing recommendation and proposal structure delivered.');
  }
  if (/close|contract|checkout|pay/i.test(goal)) {
    specialists.push(SPECIALISTS.negotiator, SPECIALISTS.treasurer, SPECIALISTS.gatekeeper, SPECIALISTS.closing);
    successCriteria.push('A contract and checkout ready for founder approval before sending.');
  }
  if (specialists.length === 0) {
    specialists.push(SPECIALISTS.strategist, SPECIALISTS.marketer, SPECIALISTS.intelligence);
    successCriteria.push('A written strategy with a decision the founder can approve or reject.');
  }

  const makesSense = Boolean(company.company_name || company.products || /test|sample/i.test(goal));
  return {
    makesSense,
    reasoning,
    specialists,
    successCriteria,
    budgetCents,
    requiresHumanApproval: /contract|send|pay|close/i.test(goal)
  };
}

function buildSalesStrategy(knowledge) {
  const company = (knowledge && knowledge.company) || {};
  const products = (knowledge && knowledge.products) || [];
  const personas = (knowledge && knowledge.personas) || [];
  const competitors = Array.isArray(company.competitors) ? company.competitors : [];

  const primaryPersona = personas[0] || { name: 'Decision-maker', goals: '', pain_points: '' };
  const icp = {
    industries: Array.isArray(company.ideal_customer) ? company.ideal_customer : [],
    geos: Array.isArray(company.countries) ? company.countries : [],
    persona: primaryPersona.name,
    pain: primaryPersona.pain_points || company.problem || ''
  };

  const positioning = company.differentiator || company.pitch || `Best-in-class ${company.products || company.company_name || 'solution'}`;

  const pricing = products.map(p => ({
    name: p.name,
    price: p.price || 'TBD',
    anchor: p.price ? `Anchor at ${p.price} and discount on multi-year commitment` : 'Price anchoring needed'
  }));

  const pipelineEstimate = {
    targetSegments: icp.industries.length ? icp.industries : ['Segment the ICP further'],
    accountsPerQuarter: 50,
    expectedConversion: 0.1,
    acv: products[0] && products[0].price ? Number((String(products[0].price).match(/\d+/g) || [0]).slice(0, 1)[0] || 0) : 0,
    potentialAnnualRevenue: null,
    priority: []
  };
  pipelineEstimate.potentialAnnualRevenue = pipelineEstimate.expectedConversion * pipelineEstimate.accountsPerQuarter * 4 * pipelineEstimate.acv;
  if (competitors.length) {
    pipelineEstimate.priority = competitors.slice(0, 3).map(c => ({
      account: `${c} customers`,
      why: `Win customers currently served by ${c}`,
      outreach: 'Warm intro via case study + migration offer'
    }));
  }

  return { icp, positioning, pricing, pipelineEstimate, ascii: buildStrategyAscii(company.company_name || 'this company') };
}

function buildStrategyAscii(company) {
  const box = (title, lines) => {
    const w = Math.max(title.length, ...lines.map(l => l.length)) + 4;
    const top = '╭' + '─'.repeat(w) + '╮';
    const bottom = '╰' + '─'.repeat(w) + '╯';
    const rows = lines.map(l => '│ ' + l.padEnd(w - 2) + ' │');
    return [top, `│ ${title.padEnd(w - 2)} │`, top.replace('╭', '├').replace('╮', '┤'), ...rows, bottom].join('\n');
  };
  return box('SALES STRATEGY FOR ' + company.toUpperCase(), [
    '1. Target the segments where we win fastest',
    '2. Lead with the differentiator, not the product',
    '3. Price on value; discount only on commitment',
    '4. Get founder approval before anything ships'
  ]);
}

module.exports = { evaluateMission, buildSalesStrategy, SPECIALISTS };
