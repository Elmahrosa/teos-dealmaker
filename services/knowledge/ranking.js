'use strict';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const SOURCE_BOOST = {
  lessons: 0.15,
  company: 0.1,
  playbook: 0.05,
  plan: 0.05,
  uploaded: 0.03
};

function recency(doc) {
  const ts = doc.updated_at || doc.created_at;
  if (!ts) return 0.5;
  const age = Date.now() - new Date(ts).getTime();
  if (age < 0) return 1;
  return Math.max(0, 1 - age / MONTH_MS);
}

function rerank(hits, { recencyWeight = 0.1, sourceWeight = 0.1, minScore = 0 } = {}) {
  return hits
    .map(hit => {
      const raw = hit.score;
      const score = Math.min(
        1,
        raw + recency(hit.doc) * recencyWeight + (SOURCE_BOOST[hit.doc.source_type] || 0) * sourceWeight
      );
      return { ...hit, rawScore: raw, score };
    })
    .filter(hit => hit.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

module.exports = { rerank, recency, SOURCE_BOOST };
