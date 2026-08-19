// services/providerExecutor.js
// Executes provider calls (real and simulated) and calculates costs

const { PROVIDERS } = require('./providerConfig');

function simulate(agentType, prompt, providerKey, model) {
  const seed = hash(`${agentType}|${providerKey}|${model}|${prompt}`);
  const actions = {
    orchestrator: 'route to the highest-fit agent for immediate action',
    prospecting: 'add the target to the research queue for scoring',
    market_intelligence: 'compile a company dossier with recent signals',
    qualification: 'classify by BANT and route to qualification queue',
    outreach: 'draft a personalized first-touch email',
    strategist: 'write a tactical deal playbook',
    marketer: 'craft value positioning for the proposal',
    sales: 'prepare objection handling for the follow-up',
    negotiator: 'set terms and discount thresholds',
    treasurer: 'prepare the contract and checkout',
    gatekeeper: 'review the draft against safety policy',
    closing: 'finalize close or block the deal',
    intelligence: 'answer the question from retrieved company knowledge with cited sources'
  };
  const next = actions[agentType] || 'process the lead through the workforce';
  const trimmed = String(prompt).length > 80 ? String(prompt).slice(0, 80) + '…' : String(prompt);
  const outputTokens = estimateOutputTokens(seed);
  const inputTokens = estimateTokens(prompt);
  return {
    text: `Recommended action: ${next}.\n\nContext reviewed: ${trimmed}.\n\nOutput verified against policy checks and logged to the audit vault for governance.`,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    simulated: true
  };
}

async function realCall(providerKey, model, prompt, opts) {
  const p = PROVIDERS[providerKey];
  const o = opts || {};
  const timeoutMs = Number(o.timeoutMs || process.env.PROVIDER_TIMEOUT_MS || 60000) || 60000;
  const headers = { 'Content-Type': 'application/json' };
  let url;
  let body;
  if (p.api === 'anthropic') {
    url = `${p.baseUrl}/messages`;
    headers['x-api-key'] = process.env[p.keyEnv];
    headers['anthropic-version'] = '2023-06-01';
    body = { model, max_tokens: o.maxTokens || 512, temperature: o.temperature || 0.7, messages: [{ role: 'user', content: prompt }] };
  } else if (p.api === 'gemini') {
    url = `${p.baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(process.env[p.keyEnv])}`;
    body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: o.temperature || 0.7, maxOutputTokens: o.maxTokens || 512 } };
  } else {
    url = `${p.baseUrl}/chat/completions`;
    if (p.keyEnv) headers['Authorization'] = `Bearer ${process.env[p.keyEnv]}`;
    body = { model, messages: [{ role: 'user', content: prompt }], temperature: o.temperature || 0.7, max_tokens: o.maxTokens || 512 };
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller ? controller.signal : undefined });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Provider ${providerKey} HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
    const data = await res.json();
    let text;
    let inputTokens;
    let outputTokens;
    if (p.api === 'anthropic') {
      text = (data.content || []).map(c => c.text || '').join('');
      inputTokens = data.usage ? data.usage.input_tokens || 0 : 0;
      outputTokens = data.usage ? data.usage.output_tokens || 0 : 0;
    } else if (p.api === 'gemini') {
      text = (data.candidates && data.candidates[0] && data.candidates[0].content.parts || []).map(part => part.text || '').join('');
      inputTokens = data.usageMetadata ? data.usageMetadata.promptTokenCount || 0 : 0;
      outputTokens = data.usageMetadata ? data.usageMetadata.candidatesTokenCount || 0 : 0;
    } else {
      text = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content || '' : '';
      inputTokens = data.usage ? data.usage.prompt_tokens || 0 : 0;
      outputTokens = data.usage ? data.usage.completion_tokens || 0 : 0;
    }
    return { text, input_tokens: inputTokens, output_tokens: outputTokens, simulated: false };
  } catch (err) {
    if (controller && err && err.name === 'AbortError') {
      throw new Error(`Provider ${providerKey} ${model} timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function costFromTokens(providerKey, model, inputTokens, outputTokens) {
  const pr = pricing(providerKey, model);
  const dollars = (inputTokens / 1000) * pr.inputPer1K + (outputTokens / 1000) * pr.outputPer1K;
  return Math.round(dollars * 100);
}

// Reuse hash and estimateTokens from providerConfig
const { hash, estimateTokens, estimateOutputTokens, pricing } = require('./providerConfig');

module.exports = {
  simulate,
  realCall,
  costFromTokens,
  hash,
  estimateTokens,
  estimateOutputTokens,
  pricing
};
