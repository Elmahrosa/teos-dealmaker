const { createRepos } = require('../db/repos');

const MEMORY_DEFAULTS = {
  company_name: '',
  industry: '',
  products: [],
  services: [],
  icp: { industries: [], companySize: '', geos: [] },
  competitors: [],
  brand_voice: '',
  sales_playbook: '',
  languages: [],
  documents: [],
  preferred_providers: []
};

const CONTEXT_MAP = {
  orchestrator: Object.keys(MEMORY_DEFAULTS),
  prospecting: ['industry', 'icp', 'competitors'],
  market_intelligence: ['industry', 'competitors', 'icp'],
  qualification: ['icp', 'products', 'services'],
  outreach: ['company_name', 'brand_voice', 'sales_playbook', 'languages', 'products'],
  strategist: ['industry', 'competitors', 'sales_playbook', 'products'],
  marketer: ['company_name', 'brand_voice', 'products', 'services', 'sales_playbook'],
  sales: ['products', 'services', 'icp'],
  negotiator: ['products', 'preferred_providers'],
  treasurer: ['preferred_providers', 'company_name'],
  gatekeeper: ['brand_voice'],
  closing: ['company_name', 'products']
};

async function ensureDefaults(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const existing = await repos.memory.list(workspaceId);
  const keys = new Set(existing.map(e => e.key));
  for (const [key, value] of Object.entries(MEMORY_DEFAULTS)) {
    if (!keys.has(key)) {
      await repos.memory.upsert(workspaceId, key, value, 'default');
    }
  }
}

async function getMemory(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const [entries, deals] = await Promise.all([
    repos.memory.list(workspaceId),
    repos.deals.list(workspaceId, {})
  ]);
  const memory = {};
  for (const key of Object.keys(MEMORY_DEFAULTS)) memory[key] = undefined;
  for (const e of entries) memory[e.key] = e.value;
  memory.past_deals = deals.map(d => ({
    id: d.id,
    company: d.company_name,
    stage: d.stage,
    status: d.status,
    value: d.deal_value
  }));
  return memory;
}

async function getContextFor(adapter, workspaceId, agentType) {
  const memory = await getMemory(adapter, workspaceId);
  const keys = CONTEXT_MAP[agentType] || Object.keys(MEMORY_DEFAULTS);
  const ctx = {};
  for (const key of keys) ctx[key] = memory[key];
  ctx.past_deals = memory.past_deals;
  return ctx;
}

async function setMemory(adapter, workspaceId, key, value, source = 'manual') {
  const repos = createRepos(adapter);
  if (!(key in MEMORY_DEFAULTS)) throw new Error(`Unknown memory key: ${key}`);
  return repos.memory.upsert(workspaceId, key, value, source);
}

function describe(memory) {
  const list = [];
  if (memory.company_name) list.push(`Company: ${memory.company_name}`);
  if (memory.industry) list.push(`Industry: ${memory.industry}`);
  if (memory.products && memory.products.length) list.push(`Products: ${memory.products.join(', ')}`);
  if (memory.services && memory.services.length) list.push(`Services: ${memory.services.join(', ')}`);
  if (memory.icp && (memory.icp.industries || []).length) list.push(`ICP: ${memory.icp.industries.join(', ')}`);
  if (memory.competitors && memory.competitors.length) list.push(`Competitors: ${memory.competitors.join(', ')}`);
  if (memory.brand_voice) list.push(`Brand voice: ${memory.brand_voice}`);
  if (memory.sales_playbook) list.push(`Playbook: ${memory.sales_playbook}`);
  if (memory.languages && memory.languages.length) list.push(`Languages: ${memory.languages.join(', ')}`);
  if (memory.documents && memory.documents.length) list.push(`Documents: ${memory.documents.length} uploaded`);
  if (memory.preferred_providers && memory.preferred_providers.length) list.push(`Providers: ${memory.preferred_providers.join(', ')}`);
  return list;
}

module.exports = { MEMORY_DEFAULTS, CONTEXT_MAP, ensureDefaults, getMemory, getContextFor, setMemory, describe };
