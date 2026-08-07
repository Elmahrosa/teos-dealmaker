'use strict';

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function similar(query, doc, embed) {
  const qv = embed(query);
  const dv = doc.embedding || embed((doc.content || '') + ' ' + (doc.title || ''));
  return cosine(qv, dv);
}

async function search(docs, query, { embed, topK = 5, minScore = 0 } = {}) {
  const scored = [];
  for (const doc of docs) {
    scored.push({ doc, score: similar(query, doc, embed) });
  }
  return scored
    .filter(s => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

module.exports = { cosine, similar, search };
