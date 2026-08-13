// services/revenueOps/discovery.js
// Target-customer discovery + deterministic scoring. Every prospect is scored
// from explainable signals (verifiability, named-company, product-category fit,
// observed engagement) and the result is persisted onto the prospect with an
// audit entry — no black-box scores, no silent side effects.
'use strict';

const { now } = require('./core');

const GENERIC_NAMES = new Set(['company', 'newco', 'new company', 'acme', 'startup', 'llc', 'inc', 'corp', 'gmbh', 'ltd', 'unknown']);
const ENGAGEMENT_POINTS = Object.freeze({ DISCOVERED: 0, SENT: 8, DELIVERED: 10, OPENED: 12, CLICKED: 16, REPLIED: 20, ENGAGED: 20, QUALIFIED: 16 });

const CATEGORY_TAXONOMY = Object.freeze({
  'revenue-operations': ['sales', 'revenue', 'dealmaker', 'revops', 'crm', 'outbound', 'pipeline'],
  'ai-content': ['content', 'generation', 'marketing', 'creative', 'social', 'video', 'copy'],
  'security-governance': ['security', 'compliance', 'governance', 'audit', 'cyber', 'sentinel', 'risk'],
  'sovereign-healthcare': ['health', 'care', 'medical', 'clinic', 'hospital'],
  'sovereign-infrastructure': ['sovereign', 'cloud', 'infrastructure', 'on-premise', 'datacenter', 'government', 'public sector'],
  'developer-platform': ['api', 'developer', 'platform', 'saas', 'software']
});

function matchCategory(category) {
  const text = String(category || '').toLowerCase();
  if (!text) return null;
  for (const [key, keywords] of Object.entries(CATEGORY_TAXONOMY)) {
    if (key.includes(text)) return key;
    for (const kw of keywords) {
      if (text.includes(kw)) return key;
    }
  }
  return null;
}

function hasWebsite(website) {
  const w = String(website || '').trim();
  return w.length >= 4 && (w.includes('.') || w.includes('localhost'));
}

function isGenericCompany(name) {
  const n = String(name || '').trim().toLowerCase();
  return n === '' || GENERIC_NAMES.has(n);
}

function engagementPoints(prospect) {
  const raw = String((prospect && (prospect.status || prospect.last_action)) || '').toUpperCase();
  return ENGAGEMENT_POINTS[raw] !== undefined ? ENGAGEMENT_POINTS[raw] : 0;
}

// Pure, explainable scorer. Inputs: { company_name, website, contact_email,
// category, score, status, last_action }. Returns { score, reason[], confidence,
// sentinel_verdict }.
function scoreCandidate(candidate) {
  const c = candidate || {};
  const reasons = [];
  let score = 20;
  let confidence = 60;

  if (hasWebsite(c.website)) {
    score += 20;
    confidence += 20;
    reasons.push('verifiable website');
  }
  if (String(c.contact_email || '').includes('@')) {
    score += 15;
    confidence += 20;
    reasons.push('direct contact present');
  }
  const named = !isGenericCompany(c.company_name);
  if (named) {
    score += 15;
    reasons.push('named company');
  }
  const cat = matchCategory(c.category);
  if (cat) {
    score += 10;
    reasons.push(`category fit: ${cat}`);
  }
  const eng = engagementPoints(c);
  score += eng;
  if (eng >= 12) reasons.push(`observed engagement ${eng}`);
  if (!named) {
    score -= 15;
    reasons.push('generic company name');
  }

  score = Math.max(0, Math.min(100, score));
  confidence = Math.max(0, Math.min(100, confidence));
  const sentinel_verdict = score >= 70 ? 'approve' : (score >= 45 ? 'review' : 'hold');
  return { score, reason: reasons.join(' · ') || 'no qualifying signals yet', confidence, sentinel_verdict };
}

function stageFor(score) {
  if (score >= 70) return 'engaged';
  if (score >= 45) return 'qualified';
  return 'discovered';
}

async function repos(db) {
  return db.repos || require('../../db/repos').createRepos(db.adapter);
}

// Scores the current prospect population (idempotent — re-scoring updates in
// place). Returns { ok, scored, results } and writes PROSPECT_SCORED audits.
async function discover(db, opts) {
  const o = opts || {};
  const r = await repos(db);
  const candidates = await db.adapter.find('prospects', {}, {
    orderBy: o.orderBy || 'score', order: o.order || 'desc', limit: Number(o.limit || 50)
  });
  const results = [];
  let scored = 0;
  for (const prospect of candidates) {
    if (o.onlyUnscored && (prospect.score_source === 'revenue-ops-discovery')) continue;
    const verdict = scoreCandidate(prospect);
    await db.adapter.update('prospects', { id: prospect.id }, {
      score: verdict.score,
      score_reason: verdict.reason,
      score_source: 'revenue-ops-discovery',
      score_timestamp: now(),
      confidence: verdict.confidence,
      sentinel_verdict: verdict.sentinel_verdict,
      stage: stageFor(verdict.score)
    });
    scored += 1;
    results.push({ id: prospect.id, company_name: prospect.company_name, score: verdict.score, verdict: verdict.sentinel_verdict, reason: verdict.reason });
    r.audit.add({
      workspace_id: null,
      agent_name: 'revenue-ops',
      action_type: 'PROSPECT_SCORED',
      timestamp: now(),
      details: { prospect_id: prospect.id, company_name: prospect.company_name, score: verdict.score, verdict: verdict.sentinel_verdict, reason: verdict.reason }
    });
  }
  return { ok: true, scored, results };
}

module.exports = { scoreCandidate, discover, matchCategory, stageFor, hasWebsite, isGenericCompany, CATEGORY_TAXONOMY };
