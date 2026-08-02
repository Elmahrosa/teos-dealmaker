const design = require('../design');
const { getStoreAdapter } = require('../store');
const memory = require('../../services/memory');
const { getCtx, titleCase } = require('./lib');

async function buildSettings(userId) {
  const ctx = await getCtx(userId);
  const s = (ctx && ctx.settings) || { lang: 'en', timezone: 'UTC', notifications: 'on', theme: 'system' };
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Settings')}`,
    design.it('Workspace configuration'),
    design.divider(),
    design.row('Language', s.lang),
    design.row('Timezone', s.timezone),
    design.row('Notifications', s.notifications),
    design.row('Theme', s.theme),
    design.section('KNOWLEDGE'),
    design.it('Company Intelligence stores what your company knows — products, pricing, FAQs, playbooks, competitor and customer profiles, and past proposals and conversations.'),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('English', 'cc_set_lang:en'), design.textButton('العربية', 'cc_set_lang:ar')],
      [design.textButton('Company Intelligence', 'cc_intelligence')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function buildAiGuide() {
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('AI Guide')}`,
    design.it('How your revenue team works'),
    design.divider(),
    design.section('YOUR REVENUE TEAM'),
    design.it('13 specialists run your revenue motion: Prospecting → Qualification → Outreach → Sales → Negotiation → Treasurer → Closing.'),
    design.section('MISSIONS'),
    design.it('Every mission starts with the Revenue Strategist, which decides if it makes sense, picks the specialists, sets success criteria and a budget, and asks for your approval before anything ships.'),
    design.section('FLOW'),
    design.it('A deal moves Lead → Qualified → Meeting → Proposal → Negotiation → Won → Customer. Specialists advance it automatically.'),
    design.section('TEAM'),
    design.it('Specialists hand off work — each leaves notes for the next, like a real team.'),
    design.section('BUSINESS KNOWLEDGE'),
    design.it('The system remembers your products, pricing, ICP and competitors — every specialist reads the context it needs before acting, and you can ask it questions with /ask.'),
    design.section('INTEGRATION HUB'),
    design.it('Connect CRM, email, calendar, storage, website and communication tools. Specialists use one uniform interface — searchContacts, searchDeals, sendMessage, createMeeting, storeDocument, fetchKnowledge, crawl — and synced data flows straight into Company Intelligence.'),
    design.section('CONTROL'),
    design.it('Run /mission <goal> to launch a mission. Open Mission Center for progress and approvals.'),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildMemory(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel('No workspace', 'Provision a workspace first.').text, keyboard: null };
  const mem = await memory.getMemory(getStoreAdapter(), ctx.workspace.id);
  const rows = memory.describe(mem);
  const lines = [
    `${design.EMOJI.ai} ${design.b('Business Knowledge')}`,
    design.it('Core profile every agent reads before working.'),
    design.divider(),
    ...(rows.length ? rows.map(r => design.row(r.split(':')[0], r.split(':').slice(1).join(':'))) : [design.it('Nothing saved yet — add your company details below.')]),
    design.section('HOW AGENTS USE IT'),
    design.it('Prospector: industry · ICP · competitors'),
    design.it('Outreach: brand voice · playbook · languages'),
    design.it('Negotiator: products · preferred providers'),
    design.divider()
  ];
  return {
    text: design.compose(lines),
    keyboard: design.keyboard([
      [design.textButton('Edit Company', 'cc_mem_edit:company_name'), design.textButton('Edit Industry', 'cc_mem_edit:industry')],
      [design.textButton('Edit Products', 'cc_mem_edit:products'), design.textButton('Edit Services', 'cc_mem_edit:services')],
      [design.textButton('Edit ICP', 'cc_mem_edit:icp'), design.textButton('Edit Competitors', 'cc_mem_edit:competitors')],
      [design.textButton('Edit Brand Voice', 'cc_mem_edit:brand_voice'), design.textButton('Edit Playbook', 'cc_mem_edit:sales_playbook')],
      [design.textButton('Intelligence Hub', 'cc_intelligence')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function buildMemoryEdit(userId, key) {
  const hints = {
    company_name: 'Company name',
    industry: 'Industry (e.g. SaaS, Fintech, Logistics)',
    products: 'Products (comma-separated)',
    services: 'Services (comma-separated)',
    icp: 'Ideal Customer Profile, e.g. industries: SaaS; size: 50-500; geos: US, EU',
    competitors: 'Competitors (comma-separated)',
    brand_voice: 'Brand voice (e.g. direct, consultative, friendly)',
    sales_playbook: 'Sales playbook (e.g. value-led, MEDDIC, consultative)'
  };
  const label = hints[key] || key;
  return {
    text: design.compose([
      `${design.EMOJI.ai} ${design.b('Edit ' + titleCase(key))}`,
      design.it(label),
      design.divider(),
      design.it('Type the new value below.'),
      design.it('For lists, separate items with commas.'),
      design.divider()
    ]),
    keyboard: design.keyboard([
      [design.textButton('Cancel', 'cc_mem_cancel')]
    ])
  };
}

module.exports = { buildSettings, buildAiGuide, buildMemory, buildMemoryEdit };
