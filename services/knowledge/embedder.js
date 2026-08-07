'use strict';

const DIMENSION = 64;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function hashWord(word) {
  let h = 0;
  for (let i = 0; i < word.length; i += 1) {
    h = (h * 31 + word.charCodeAt(i)) >>> 0;
  }
  return h;
}

function embed(text, dim = DIMENSION) {
  const vec = new Float64Array(dim);
  for (const word of tokenize(text)) {
    vec[hashWord(word) % dim] += 1;
  }
  return vec;
}

async function remoteEmbed(text, { fetchImpl, url, apiKey }) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ input: String(text || '').slice(0, 8000) })
  });
  if (!res.ok) throw new Error(`embedding provider failed: ${res.status}`);
  const data = await res.json();
  return data.data && data.data[0] ? data.data[0].embedding : null;
}

function createEmbedder(options = {}) {
  const { provider, url, apiKey, fetchImpl } = options;
  if (provider && url && apiKey && fetchImpl) {
    return text => remoteEmbed(text, { fetchImpl, url, apiKey });
  }
  return text => embed(text);
}

module.exports = { tokenize, hashWord, embed, createEmbedder, DIMENSION };
