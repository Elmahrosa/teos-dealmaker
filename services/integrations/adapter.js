const { CONNECTORS, isConfigured } = require('./catalog');
const { hash } = require('../providers');

const CAPABILITIES = {
  searchContacts: 'crm',
  searchDeals: 'crm',
  sendMessage: 'communication',
  createMeeting: 'calendar',
  storeDocument: 'storage',
  crawl: 'website'
};

function pickConnector(enabledIds, connectorId, category) {
  if (connectorId && enabledIds.includes(connectorId) && CONNECTORS[connectorId]) return connectorId;
  const candidates = enabledIds.filter(id => CONNECTORS[id] && CONNECTORS[id].category === category);
  if (candidates.length) return candidates[0];
  const configured = Object.keys(CONNECTORS).find(id =>
    CONNECTORS[id].category === category && isConfigured(id)
  );
  return configured || null;
}

function buildRequest(connectorId, op, args) {
  const c = CONNECTORS[connectorId];
  if (!c || !c[op]) return null;
  const spec = c[op];
  const a = args || {};
  const headers = { 'Content-Type': 'application/json' };
  let url;
  let body = null;
  let base = c.baseUrl;
  if (connectorId === 'website') {
    base = `https://${String(a.domain || 'example.com').replace(/^https?:\/\//, '')}`;
  }
  if (spec.auth === 'Bearer') headers['Authorization'] = `Bearer ${process.env[c.keyEnv] || '${' + c.keyEnv + '}'}`;
  const qs = new URLSearchParams();
  if (spec.query) {
    const q = spec.query(a);
    for (const k of Object.keys(q || {})) qs.set(k, q[k]);
  }
  if (spec.auth === 'Query' && c.keyEnv) qs.set('api_token', process.env[c.keyEnv] || '${' + c.keyEnv + '}');
  if (qs.toString()) url = `${base}${spec.path}?${qs.toString()}`;
  if (spec.body) body = spec.body(a);
  if (spec.headers) Object.assign(headers, spec.headers(a));
  if (!url) url = `${base}${spec.path}`;
  if (connectorId === 'telegram' && c.keyEnv) {
    url = `https://api.telegram.org/bot${process.env[c.keyEnv] || '${' + c.keyEnv + '}'}/sendMessage`;
  }
  return { method: spec.method, url, headers, body, connectorId, op };
}

function simulate(connectorId, op, args) {
  const c = CONNECTORS[connectorId];
  const a = args || {};
  const seed = hash(`${connectorId}|${op}|${JSON.stringify(a) || 'none'}`);
  const companies = ['Nile Shipping', 'Cairo Bank', 'Delta Retail', 'Sahara Tech', 'Riyadh Health'];
  const people = ['Omar Hassan', 'Layla Ahmed', 'Karim Nasser', 'Nour Saleh', 'Tarek Fahmy'];
  const pick = (arr, i) => arr[i % arr.length];
  switch (op) {
    case 'searchContacts':
      return {
        items: [0, 1, 2].map(i => ({
          id: `${connectorId}_c${(seed + i) % 100}`,
          name: pick(people, seed + i),
          company: pick(companies, seed + i),
          email: `${pick(people, seed + i).toLowerCase().replace(' ', '.')}@${pick(companies, seed + i).toLowerCase().replace(/[^a-z]/g, '')}.com`,
          source: c.label
        })),
        total: 3,
        source: c.label,
        simulated: true
      };
    case 'searchDeals':
      return {
        items: [0, 1, 2].map(i => ({
          id: `${connectorId}_d${(seed + i) % 100}`,
          company: pick(companies, seed + i),
          value: 5000 + ((seed * (i + 3)) % 25000),
          stage: ['lead', 'qualification', 'negotiation'][i % 3],
          status: 'open',
          source: c.label
        })),
        total: 3,
        source: c.label,
        simulated: true
      };
    case 'sendMessage':
      return {
        messageId: `${connectorId}_m${seed % 100000}`,
        status: 'sent',
        to: a.to || null,
        source: c.label,
        simulated: true
      };
    case 'createMeeting':
      return {
        meetingId: `${connectorId}_ev${seed % 100000}`,
        title: a.title || 'Discovery Call',
        start: a.start || new Date().toISOString(),
        end: a.end || null,
        source: c.label,
        simulated: true
      };
    case 'storeDocument':
      return {
        fileId: `${connectorId}_f${seed % 100000}`,
        title: a.title || a.name || 'document',
        source: c.label,
        simulated: true
      };
    case 'crawl':
      return {
        domain: a.domain || 'example.com',
        pages: 4 + (seed % 6),
        faqs: [{ question: 'How does onboarding work?', answer: 'Onboarding is delivered by a dedicated team within 7 days.' }],
        products: [{ name: 'Insights Platform', category: 'Analytics' }, { name: 'Forecast API', category: 'API' }],
        source: c.label,
        simulated: true
      };
    default:
      return { ok: true, source: c.label, simulated: true };
  }
}

async function execute(adapter, workspaceId, connectorId, op, args) {
  const repos = require('../../db/repos').createRepos(adapter);
  const conn = await repos.integrations.get(workspaceId, connectorId);
  if (conn && conn.status === 'disabled') return { error: 'connector_disabled', source: connectorId };
  const { getMode } = require('../../config/mode');
  if (isConfigured(connectorId) && getMode() === 'LIVE') {
    const req = buildRequest(connectorId, op, args);
    if (!req) return { error: 'unsupported_op', op, source: connectorId };
    try {
      const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body ? JSON.stringify(req.body) : undefined });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      return { ...data, source: CONNECTORS[connectorId].label, simulated: false };
    } catch (err) {
      const sim = simulate(connectorId, op, args);
      return { ...sim, real_error: err.message, fallback: true };
    }
  }
  return simulate(connectorId, op, args);
}

function canDo(connectorId, op) {
  return Boolean(CONNECTORS[connectorId] && CONNECTORS[connectorId][op]);
}

module.exports = { CAPABILITIES, pickConnector, buildRequest, simulate, execute, canDo };
