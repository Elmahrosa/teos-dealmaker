'use strict';

// services/revenueOps/scorecard.js
// Deterministic 11-dimension prospect scorecard used by Customer #0 self-sale.
// Every dimension is rated 0-5 (missing signals score 0 with an explicit
// reason), weighted, and combined into a 0-100 score, an A/B/C priority, and
// a Sentinel verdict consistent with the existing review gates
// (APPROVE >= 70, REVIEW >= 45, HOLD < 45).

const DIMENSIONS = [
  { key: 'icp_fit', label: 'ICP fit', weight: 0.14 },
  { key: 'revenue_pain', label: 'Revenue pain', weight: 0.10 },
  { key: 'urgency', label: 'Urgency', weight: 0.12 },
  { key: 'company_maturity', label: 'Company maturity', weight: 0.06 },
  { key: 'buyer_authority', label: 'Buyer authority', weight: 0.10 },
  { key: 'budget_potential', label: 'Budget potential', weight: 0.12 },
  { key: 'tech_ai_fit', label: 'Technical/AI fit', weight: 0.08 },
  { key: 'governance_security_fit', label: 'Governance/security fit', weight: 0.06 },
  { key: 'geo_priority', label: 'Geographic priority', weight: 0.06 },
  { key: 'evidence_quality', label: 'Evidence quality', weight: 0.10 },
  { key: 'conversion_likelihood', label: 'Conversion likelihood', weight: 0.06 }
];

const MAX_DIM = 5;
const PRIORITY = { APPROVE: 70, REVIEW: 45, HOLD: 0 };

function clampDim(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_DIM, n));
}

function weightsSum() {
  return DIMENSIONS.reduce((sum, d) => sum + d.weight, 0);
}

function scoreProspect(candidate) {
  const meta = (candidate && candidate.metadata) || {};
  const dims = meta.dimensions || candidate.dimensions || {};
  const reasons = [];
  let weighted = 0;
  for (const d of DIMENSIONS) {
    const raw = dims[d.key];
    const val = raw === undefined || raw === null ? 0 : clampDim(raw);
    weighted += d.weight * val;
    if (raw === undefined || raw === null || raw === 0) {
      reasons.push(`${d.label}: no public signal (0)`);
    } else {
      reasons.push(`${d.label}: ${val}/${MAX_DIM}`);
    }
  }
  const score = Math.round((weighted / MAX_DIM) * 100);
  const priority = score >= PRIORITY.APPROVE ? 'A' : score >= PRIORITY.REVIEW ? 'B' : 'C';
  const sentinelVerdict = score >= PRIORITY.APPROVE ? 'APPROVE' : score >= PRIORITY.REVIEW ? 'REVIEW' : 'HOLD';
  return {
    score,
    priority,
    sentinel_verdict: sentinelVerdict,
    dimensions: Object.fromEntries(DIMENSIONS.map(d => [d.key, clampDim(dims[d.key])])),
    reasons
  };
}

function recommendTop(prospects) {
  const scored = (prospects || [])
    .filter(Boolean)
    .map(p => ({ ...p, card: p.card || scoreProspect(p) }));
  scored.sort((a, b) => {
    if (b.card.score !== a.card.score) return b.card.score - a.card.score;
    return String(a.company_name || '').localeCompare(String(b.company_name || ''));
  });
  const top = scored[0] || null;
  const runnerUp = scored[1] || null;
  return { top, runnerUp };
}

module.exports = { DIMENSIONS, scoreProspect, recommendTop, weightsSum, MAX_DIM, PRIORITY };
