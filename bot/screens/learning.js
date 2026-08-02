const design = require('../design');

async function buildLearn(userId, progress) {
  const p = progress || {};
  const pct = p.pct || 0;
  const fill = Math.round((pct / 100) * 10);
  const bar = '█'.repeat(fill) + '░'.repeat(10 - fill);
  const sectionLines = [
    `🏢 Company Intelligence    ${p.companyAnswered || 0}/${p.companyTotal || 0}`,
    `📦 Product Intelligence    ${p.products || 0} product${(p.products || 0) === 1 ? '' : 's'}`,
    `📖 Sales Playbook          ${p.playbookAnswered || 0}/${p.playbookTotal || 0}`,
    `👥 Customer Personas       ${p.personas || 0} persona${(p.personas || 0) === 1 ? '' : 's'}`
  ];
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Welcome! Your AI Revenue Team is ready.')}`,
    design.it('What would you like to accomplish?'),
    design.divider(),
    `${design.EMOJI.rocket} ${design.b('Sell TEOS Dealmaker')} — learn your business, then build strategy, prospects and first outreach.`,
    `${design.EMOJI.target} ${design.b('Find New Customers')} — run a full revenue pipeline for your known products.`,
    `${design.EMOJI.globe} ${design.b('Analyze a Market')} — research a market and map opportunity.`,
    `${design.EMOJI.brain} ${design.b('Build Company Intelligence')} — finish the learning interview.`,
    design.divider(),
    `${design.code(bar)} ${design.b('Company Knowledge ' + pct + '%')}`,
    ...sectionLines,
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('🚀 Sell TEOS Dealmaker', 'cc_mission1')],
      [design.textButton('📈 Find New Customers', 'cc_mission2'), design.textButton('🌍 Analyze a Market', 'cc_mission_market')],
      [design.textButton('🧠 Build Company Intelligence', 'cc_learn')],
      [design.textButton('Mission Center', 'cc_missions')]
    ])
  };
}

module.exports = { buildLearn };
