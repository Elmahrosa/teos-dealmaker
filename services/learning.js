const { forWorkspace } = require('../db/repos');
const intelligence = require('./intelligence');
const memory = require('./memory');

const SECTIONS = [
  { id: 'company', label: 'Company Intelligence', icon: '🏢' },
  { id: 'product', label: 'Product Intelligence', icon: '📦' },
  { id: 'playbook', label: 'Sales Playbook', icon: '📖' },
  { id: 'persona', label: 'Customer Personas', icon: '👥' }
];

const COMPANY_QUESTIONS = [
  { key: 'company_name', text: 'What does your company do? (one line)', required: true, source: 'company_profile' },
  { key: 'problem', text: 'What problem do you solve for customers?', required: true, source: 'company_profile' },
  { key: 'products', text: 'What are your main products? (comma-separated)', required: true, source: 'products', list: true },
  { key: 'ideal_customer', text: 'Who are your ideal customers? (e.g. B2B SaaS founders in fintech)', required: true, source: 'personas' },
  { key: 'countries', text: 'Which countries or regions do you sell to?', required: false, source: 'company_profile', list: true },
  { key: 'competitors', text: 'Who are your biggest competitors? (comma-separated)', required: false, source: 'competitors', list: true },
  { key: 'differentiator', text: 'In one sentence, what makes you different from competitors?', required: false, source: 'playbooks' },
  { key: 'pitch', text: 'What is your elevator pitch?', required: false, source: 'playbooks' }
];

const PRODUCT_QUESTIONS = [
  { key: 'name', text: 'What is the product name?' },
  { key: 'price', text: 'What is the price? (e.g. $99/month)' },
  { key: 'target_customer', text: 'Who is the target customer for this product?' },
  { key: 'benefits', text: 'What are the main benefits?' },
  { key: 'objections', text: 'What objections do customers raise?' },
  { key: 'demo_url', text: 'Demo URL?' },
  { key: 'documentation', text: 'Documentation link?' },
  { key: 'case_studies', text: 'Case studies or success stories?' }
];

const PLAYBOOK_QUESTIONS = [
  { key: 'who_buys', text: 'Who typically buys from you?', required: true },
  { key: 'who_approves', text: 'Who approves the purchase?', required: false },
  { key: 'budget', text: 'What is the typical budget range?', required: false },
  { key: 'cycle', text: 'How long is the buying cycle?', required: false },
  { key: 'why_buy', text: 'Why do customers choose you?', required: true },
  { key: 'why_reject', text: 'Why do customers reject you?', required: false },
  { key: 'discounts', text: 'What discounts are allowed?', required: false },
  { key: 'escalate', text: 'When should the AI escalate to a human?', required: false }
];

const PERSONA_QUESTIONS = [
  { key: 'goals', text: 'What are this persona\'s goals?' },
  { key: 'kpis', text: 'What KPIs do they track?' },
  { key: 'pain_points', text: 'What are their biggest pain points?' },
  { key: 'budget_authority', text: 'Do they have budget authority?', required: true },
  { key: 'buying_triggers', text: 'What triggers them to buy?' },
  { key: 'objections', text: 'What objections do they raise?' }
];

const DEFAULT_PERSONAS = ['CTO', 'CEO', 'Founder', 'Sales Director'];

function memoryKey(section, key, context) {
  if (section === 'product') return `product_${context}_${key}`;
  if (section === 'persona') return `persona_${context}_${key}`;
  return `learning_${key}`;
}

function sourceFor(section, key, question) {
  if (question && question.source) return question.source;
  if (section === 'company') return 'company_profile';
  if (section === 'product') return 'products';
  if (section === 'playbook') return 'playbooks';
  if (section === 'persona') return 'personas';
  return 'documents';
}

function splitList(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

async function record(adapter, workspaceId, { section, key, value, context }) {
  const repos = forWorkspace(adapter, workspaceId);
  const text = String(value || '').trim();
  const listValue = splitList(text);
  const storedKey = memoryKey(section, key, context);
  await repos.memory.set(storedKey, text, 'learning');

  if (section === 'company') {
    if (key === 'company_name') await memory.setMemory(adapter, workspaceId, 'company_name', text);
    if (key === 'products') await memory.setMemory(adapter, workspaceId, 'products', listValue);
    if (key === 'competitors') await memory.setMemory(adapter, workspaceId, 'competitors', listValue);
    if (key === 'ideal_customer' || key === 'countries') {
      const current = await repos.memory.get('icp');
      const icp = { ...(current && current.value ? current.value : {}), industries: [], companySize: '', geos: [] };
      if (key === 'ideal_customer') icp.industries = splitList(text);
      if (key === 'countries') icp.geos = listValue;
      await memory.setMemory(adapter, workspaceId, 'icp', icp);
    }
    if (key === 'differentiator' || key === 'pitch') {
      await memory.setMemory(adapter, workspaceId, 'brand_voice', text);
    }
  }
  if (section === 'playbook' && ['who_buys', 'why_buy', 'why_reject', 'discounts', 'escalate'].includes(key)) {
    const playbook = await getKnowledge(adapter, workspaceId);
    const combined = Object.keys(playbook.playbook).map(k => `${k}: ${playbook.playbook[k]}`).filter(l => l.length > 3).join('\n');
    await memory.setMemory(adapter, workspaceId, 'sales_playbook', combined || text);
  }

  const q = questionFor(section, key);
  await intelligence.addDocument(adapter, workspaceId, {
    title: `${sectionLabel(section)} — ${q ? q.text.slice(0, 60) : key}`,
    source_type: sourceFor(section, key, q),
    content: context ? `${context}: ${text}` : text,
    metadata: { section, key, context, source: 'learning' }
  });
  return { storedKey, value: text };
}

function questionFor(section, key) {
  if (section === 'company') return COMPANY_QUESTIONS.find(q => q.key === key);
  if (section === 'product') return PRODUCT_QUESTIONS.find(q => q.key === key);
  if (section === 'playbook') return PLAYBOOK_QUESTIONS.find(q => q.key === key);
  if (section === 'persona') return PERSONA_QUESTIONS.find(q => q.key === key);
  return null;
}

function sectionLabel(section) {
  const s = SECTIONS.find(x => x.id === section);
  return s ? s.label : section;
}

function totalQuestions() {
  return COMPANY_QUESTIONS.length + PRODUCT_QUESTIONS.length + PLAYBOOK_QUESTIONS.length + PERSONA_QUESTIONS.length;
}

async function getKnowledge(adapter, workspaceId) {
  const repos = forWorkspace(adapter, workspaceId);
  const entries = await repos.memory.list();
  const byKey = {};
  for (const e of entries) byKey[e.key] = e.value;

  const company = {};
  for (const q of COMPANY_QUESTIONS) {
    if (byKey[`learning_${q.key}`] !== undefined) company[q.key] = byKey[`learning_${q.key}`];
  }

  const productNames = Array.isArray(company.products) ? company.products : splitList(company.products);
  const products = productNames
    .map(name => {
      const product = {};
      let hasAny = false;
      for (const q of PRODUCT_QUESTIONS) {
        const v = byKey[`product_${name}_${q.key}`];
        if (v !== undefined) { product[q.key] = v; hasAny = true; }
      }
      return hasAny ? { ...product, name: product.name || name } : { name };
    })
    .filter(p => p.name);

  const playbook = {};
  for (const q of PLAYBOOK_QUESTIONS) {
    if (byKey[`learning_${q.key}`] !== undefined) playbook[q.key] = byKey[`learning_${q.key}`];
  }

  const personas = [];
  for (const e of entries) {
    const m = /^persona_(.+)_(goals|kpis|pain_points|budget_authority|buying_triggers|objections)$/.exec(e.key);
    if (m) {
      let p = personas.find(x => x.name === m[1]);
      if (!p) { p = { name: m[1] }; personas.push(p); }
      p[m[2]] = e.value;
    }
  }

  return { company, products, playbook, personas };
}

async function progress(adapter, workspaceId) {
  const knowledge = await getKnowledge(adapter, workspaceId);
  const required = COMPANY_QUESTIONS.filter(q => q.required).length + 1;
  const companyAnswered = COMPANY_QUESTIONS.filter(q => q.required && knowledge.company[q.key] !== undefined).length;
  const playbookAnswered = PLAYBOOK_QUESTIONS.filter(q => q.required && knowledge.playbook[q.key] !== undefined).length;
  const answered = companyAnswered + playbookAnswered + (knowledge.products.length ? 1 : 0) + (knowledge.personas.length ? 1 : 0);
  const total = required + PLAYBOOK_QUESTIONS.filter(q => q.required).length + 2;
  const pct = Math.round((answered / total) * 100);
  const complete = knowledge.company.company_name && knowledge.company.products && knowledge.playbook.why_buy && knowledge.personas.length > 0;
  return {
    companyAnswered,
    companyTotal: COMPANY_QUESTIONS.length,
    products: knowledge.products.length,
    playbookAnswered,
    playbookTotal: PLAYBOOK_QUESTIONS.length,
    personas: knowledge.personas.length,
    pct: complete ? 100 : Math.min(99, pct),
    complete: Boolean(complete)
  };
}

async function validate(adapter, workspaceId) {
  const knowledge = await getKnowledge(adapter, workspaceId);
  const gaps = [];
  for (const q of COMPANY_QUESTIONS) {
    if (q.required && knowledge.company[q.key] === undefined) gaps.push(`company.${q.key}`);
  }
  for (const q of PLAYBOOK_QUESTIONS) {
    if (q.required && knowledge.playbook[q.key] === undefined) gaps.push(`playbook.${q.key}`);
  }
  if (!knowledge.products.length) gaps.push('product (at least one product)');
  if (!knowledge.personas.length) gaps.push('persona (at least one persona)');
  return { knowledge, gaps, complete: gaps.length === 0 };
}

module.exports = {
  SECTIONS,
  COMPANY_QUESTIONS,
  PRODUCT_QUESTIONS,
  PLAYBOOK_QUESTIONS,
  PERSONA_QUESTIONS,
  DEFAULT_PERSONAS,
  totalQuestions,
  record,
  getKnowledge,
  progress,
  validate,
  memoryKey,
  splitList,
  questionFor,
  sectionLabel
};
