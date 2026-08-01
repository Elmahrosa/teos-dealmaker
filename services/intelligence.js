const { createRepos } = require('../db/repos');
const memorySvc = require('./memory');
const providers = require('./providers');

const SOURCE_TYPES = {
  company_profile: { label: 'Company Profile' },
  products: { label: 'Products & Services' },
  pricing: { label: 'Pricing' },
  faqs: { label: 'FAQs' },
  playbooks: { label: 'Playbooks' },
  crm_data: { label: 'CRM Data' },
  website: { label: 'Website' },
  email_templates: { label: 'Email Templates' },
  proposals: { label: 'Previous Proposals' },
  conversations: { label: 'Sales Conversations' },
  competitors: { label: 'Competitor Profiles' },
  personas: { label: 'Customer Personas' },
  documents: { label: 'Uploaded Documents' }
};

const STOPWORDS = new Set(
  'a,an,and,are,as,at,be,by,for,from,has,have,in,is,it,its,of,on,or,our,should,so,that,the,their,them,then,this,to,using,we,what,when,which,who,will,with,your,you,do,does,can,could,would,about,how,any,more,most,other,these,those'.split(',')
);

const INTENT_MAP = [
  { type: 'pricing', label: 'Pricing & packages', sources: ['pricing', 'products', 'proposals'], terms: ['price', 'pricing', 'cost', 'costs', 'plan', 'plans', 'tier', 'quote', 'budget', 'package', 'subscription', 'rates', 'fee', 'fees', 'license', 'annual', 'enterprise pricing'] },
  { type: 'product', label: 'Product fit', sources: ['products', 'personas', 'company_profile'], terms: ['product', 'products', 'fit', 'feature', 'features', 'capability', 'use case', 'use-case', 'best for', 'best fits', 'recommend', 'suitable', 'solution', 'works for'] },
  { type: 'proposal', label: 'Proposal generation', sources: ['proposals', 'pricing', 'email_templates', 'playbooks'], terms: ['proposal', 'generate', 'draft', 'create', 'write', 'pitch', 'statement of work', 'sow', 'offer for', 'quote for'] },
  { type: 'objections', label: 'Customer objections', sources: ['conversations', 'proposals', 'crm_data'], terms: ['objection', 'objections', 'raised', 'concern', 'concerns', 'hesitat', 'pushback', 'complained', 'mentioned', 'asked about', 'why'] },
  { type: 'competitor', label: 'Competitive comparison', sources: ['competitors', 'products'], terms: ['competitor', 'competitors', 'compare', 'comparison', 'versus', 'vs', 'alternative', 'differentiat', 'better than', 'stronger'] },
  { type: 'persona', label: 'Buyer personas', sources: ['personas', 'crm_data', 'company_profile'], terms: ['persona', 'personas', 'buyer', 'buyers', 'decision maker', 'cfo', 'cto', 'vp', 'founder', 'champion', 'procurement'] },
  { type: 'faq', label: 'FAQ', sources: ['faqs'], terms: ['faq', 'faqs', 'how do', 'how does', 'how to', 'what is', 'what are', 'where can'] },
  { type: 'general', label: 'Company knowledge', sources: [], terms: [] }
];

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

function chunkContent(text, size = 400) {
  const blocks = String(text || '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const chunks = [];
  for (const block of blocks) {
    if (block.length <= size) {
      chunks.push(block);
      continue;
    }
    const sentences = block.split(/(?<=[.!?])\s+/);
    let current = '';
    for (const s of sentences) {
      if (current && (current + ' ' + s).length > size) {
        chunks.push(current);
        current = s;
      } else {
        current = current ? current + ' ' + s : s;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks;
}

function detectIntent(question) {
  const q = String(question || '').toLowerCase();
  let best = null;
  for (const intent of INTENT_MAP) {
    if (intent.type === 'general') continue;
    let score = 0;
    for (const term of intent.terms) {
      const at = q.indexOf(term);
      if (at >= 0) score += 1 / (1 + at);
    }
    if (score > 0 && (!best || score > best.score)) best = { ...intent, score };
  }
  return best ? best : INTENT_MAP[INTENT_MAP.length - 1];
}

function buildIndex(docs) {
  const chunks = [];
  for (const d of docs) {
    const parts = chunkContent(d.content);
    parts.forEach((text, i) => chunks.push({ docId: d.id, title: d.title, source_type: d.source_type, text, index: i }));
  }
  const df = {};
  const postings = chunks.map(chunk => {
    const tf = {};
    for (const t of tokenize(chunk.text)) tf[t] = (tf[t] || 0) + 1;
    for (const t of Object.keys(tf)) df[t] = (df[t] || 0) + 1;
    return { chunk, tf };
  });
  return { postings, df, total: chunks.length };
}

async function retrieve(adapter, workspaceId, query, opts) {
  const o = opts || {};
  const repos = createRepos(adapter);
  const docs = await repos.intelligence.list(workspaceId);
  if (!docs.length) return [];
  const index = buildIndex(docs);
  const qTokens = tokenize(query);
  const hits = [];
  for (const { chunk, tf } of index.postings) {
    let score = 0;
    for (const t of qTokens) {
      if (!tf[t]) continue;
      const idf = Math.log(1 + index.total / (index.df[t] || 1));
      score += (1 + Math.log(tf[t])) * idf;
    }
    if (score > 0) hits.push({ docId: chunk.docId, title: chunk.title, source_type: chunk.source_type, text: chunk.text, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, o.topK || 4);
}

function synthesize(hits) {
  const best = hits[0];
  const lines = [
    `Based on ${best.title} (${SOURCE_TYPES[best.source_type] ? SOURCE_TYPES[best.source_type].label : best.source_type}):`,
    best.text.length > 280 ? best.text.slice(0, 280) + '…' : best.text
  ];
  if (hits.length > 1) {
    lines.push(`Also relevant: ${hits.slice(1, 3).map(h => h.title).join(', ')}.`);
  }
  return lines.join('\n');
}

async function ask(adapter, workspaceId, question) {
  const intent = detectIntent(question);
  const repos = createRepos(adapter);
  const docs = await repos.intelligence.list(workspaceId);
  let hits = await retrieve(adapter, workspaceId, question, { topK: 6 });
  if (hits.length && intent.sources.length) {
    hits.sort((a, b) => {
      const aBoost = intent.sources.includes(a.source_type) ? 1 : 0;
      const bBoost = intent.sources.includes(b.source_type) ? 1 : 0;
      return (b.score + bBoost * 5) - (a.score + aBoost * 5);
    });
  }
  if (!hits.length) {
    return {
      question,
      intent: { type: intent.type, label: intent.label },
      answer: null,
      evidence: [],
      provider: null,
      model: null,
      cost_cents: 0,
      simulated: false,
      docs_count: docs.length
    };
  }
  const evidenceText = hits
    .map((h, i) => `[${i + 1}] (${SOURCE_TYPES[h.source_type] ? SOURCE_TYPES[h.source_type].label : h.source_type}) ${h.title}\n${h.text}`)
    .join('\n\n');
  const prompt = [
    'You are TEOS Dealmaker\'s Enterprise Intelligence copilot.',
    'Answer the question using ONLY the company knowledge below. Cite the source label. If the knowledge does not answer it, say so and suggest what to add.',
    '',
    'KNOWLEDGE:',
    evidenceText,
    '',
    'QUESTION: ' + question
  ].join('\n');
  let llm = null;
  try {
    llm = await providers.generate(adapter, workspaceId, 'intelligence', prompt, { temperature: 0.2 });
  } catch (_) { /* fall back to evidence synthesis */ }
  const simulated = llm ? llm.simulated : true;
  const answer = llm && !llm.simulated ? llm.text : synthesize(hits);
  return {
    question,
    intent: { type: intent.type, label: intent.label },
    answer,
    provider: llm ? llm.provider : null,
    model: llm ? llm.model : null,
    cost_cents: llm ? llm.cost_cents : 0,
    simulated,
    evidence: hits.map(h => ({
      title: h.title,
      source_type: h.source_type,
      label: SOURCE_TYPES[h.source_type] ? SOURCE_TYPES[h.source_type].label : h.source_type,
      score: Math.round(h.score * 100) / 100,
      excerpt: h.text.slice(0, 180)
    })),
    docs_count: docs.length
  };
}

async function addDocument(adapter, workspaceId, { title, source_type = 'documents', content, metadata = null }) {
  const repos = createRepos(adapter);
  const type = SOURCE_TYPES[source_type] ? source_type : 'documents';
  return repos.intelligence.add({ workspace_id: workspaceId, title, source_type: type, content, metadata });
}

async function removeDocument(adapter, workspaceId, id) {
  const repos = createRepos(adapter);
  return repos.intelligence.remove(workspaceId, Number(id));
}

async function listDocuments(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const docs = await repos.intelligence.list(workspaceId);
  return docs.map(d => ({
    id: d.id,
    title: d.title,
    source_type: d.source_type,
    label: SOURCE_TYPES[d.source_type] ? SOURCE_TYPES[d.source_type].label : d.source_type,
    chunks: chunkContent(d.content).length,
    updated_at: d.updated_at || d.created_at || null,
    seeded: !!(d.metadata && d.metadata.seeded)
  }));
}

async function describe(adapter, workspaceId) {
  const docs = await listDocuments(adapter, workspaceId);
  const bySource = {};
  for (const d of docs) bySource[d.source_type] = (bySource[d.source_type] || 0) + 1;
  return {
    total_docs: docs.length,
    total_chunks: docs.reduce((acc, d) => acc + d.chunks, 0),
    sources: Object.keys(SOURCE_TYPES).map(st => ({
      source_type: st,
      label: SOURCE_TYPES[st].label,
      count: bySource[st] || 0
    })),
    seeded: docs.filter(d => d.seeded).length,
    uploaded: docs.filter(d => !d.seeded).length,
    last_updated: docs[0] ? docs[0].updated_at : null
  };
}

async function seedSources(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const mem = await memorySvc.getMemory(adapter, workspaceId);
  const sources = [];
  if (mem.company_name) {
    sources.push({
      source_type: 'company_profile',
      title: `${mem.company_name} — Company Profile`,
      content: `Company: ${mem.company_name}\nIndustry: ${mem.industry || 'not specified'}\nBrand voice: ${mem.brand_voice || 'professional'}`
    });
  }
  if ((mem.products && mem.products.length) || (mem.services && mem.services.length)) {
    sources.push({
      source_type: 'products',
      title: 'Products & Services',
      content: `Products: ${(mem.products || []).join(', ') || '—'}\nServices: ${(mem.services || []).join(', ') || '—'}`
    });
  }
  if (mem.icp && ((mem.icp.industries || []).length || mem.icp.companySize || (mem.icp.geos || []).length)) {
    sources.push({
      source_type: 'personas',
      title: 'Ideal Customer Profile & Personas',
      content: `Industries: ${(mem.icp.industries || []).join(', ') || 'not specified'}\nCompany size: ${mem.icp.companySize || 'any'}\nGeos: ${(mem.icp.geos || []).join(', ') || 'global'}`
    });
  }
  if (mem.competitors && mem.competitors.length) {
    sources.push({
      source_type: 'competitors',
      title: 'Competitor Profiles',
      content: mem.competitors.join('\n')
    });
  }
  if (mem.sales_playbook) {
    sources.push({
      source_type: 'playbooks',
      title: 'Sales Playbook',
      content: mem.sales_playbook
    });
  }
  if (mem.languages && mem.languages.length) {
    sources.push({
      source_type: 'company_profile',
      title: `${mem.company_name || 'Company'} — Languages`,
      content: `Supported languages: ${mem.languages.join(', ')}`
    });
  }
  const seeded = [];
  for (const s of sources) {
    const existing = await repos.intelligence.list(workspaceId, s.source_type);
    const seededDoc = existing.find(d => d.metadata && d.metadata.seeded);
    if (seededDoc) {
      await repos.intelligence.update(workspaceId, seededDoc.id, { title: s.title, content: s.content });
    } else {
      await repos.intelligence.add({ workspace_id: workspaceId, title: s.title, source_type: s.source_type, content: s.content, metadata: { seeded: true } });
    }
    seeded.push(s.source_type);
  }
  return seeded;
}

async function getAgentContext(adapter, workspaceId, agentType, prompt) {
  const memory = await memorySvc.getContextFor(adapter, workspaceId, agentType);
  const query = prompt || agentTopic(agentType);
  const knowledge = await retrieve(adapter, workspaceId, query, { topK: 3 });
  return { memory, knowledge };
}

function agentTopic(agentType) {
  const topics = {
    prospecting: 'ideal customer profile industries company size targets',
    market_intelligence: 'competitors industry signals',
    qualification: 'icp products services fit',
    outreach: 'brand voice products email templates playbook',
    strategist: 'playbook competitors products icp',
    marketer: 'products services brand voice',
    sales: 'products objections conversations',
    negotiator: 'pricing products terms',
    treasurer: 'pricing products contracts',
    gatekeeper: 'brand voice',
    closing: 'pricing products company profile',
    orchestrator: 'company profile products pricing playbook',
    intelligence: 'company knowledge products pricing'
  };
  return topics[agentType] || 'company knowledge';
}

module.exports = {
  SOURCE_TYPES,
  INTENT_MAP,
  tokenize,
  chunkContent,
  detectIntent,
  retrieve,
  ask,
  addDocument,
  removeDocument,
  listDocuments,
  describe,
  seedSources,
  getAgentContext
};
