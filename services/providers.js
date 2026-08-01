const { createRepos } = require('../db/repos');

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    keyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    api: 'openai',
    models: {
      'gpt-4o-mini': { inputPer1K: 0.00015, outputPer1K: 0.0006 },
      'gpt-4o': { inputPer1K: 0.0025, outputPer1K: 0.01 },
      'gpt-4.1-mini': { inputPer1K: 0.0004, outputPer1K: 0.0016 },
      'gpt-4.1': { inputPer1K: 0.002, outputPer1K: 0.008 },
      'gpt-5': { inputPer1K: 0.00125, outputPer1K: 0.01 }
    }
  },
  anthropic: {
    label: 'Claude',
    keyEnv: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    api: 'anthropic',
    models: {
      'claude-sonnet-4-5': { inputPer1K: 0.003, outputPer1K: 0.015 },
      'claude-haiku-4-5': { inputPer1K: 0.001, outputPer1K: 0.005 },
      'claude-opus-4-5': { inputPer1K: 0.005, outputPer1K: 0.025 }
    }
  },
  gemini: {
    label: 'Gemini',
    keyEnv: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    api: 'gemini',
    models: {
      'gemini-2.0-flash': { inputPer1K: 0.0001, outputPer1K: 0.0004 },
      'gemini-2.5-pro': { inputPer1K: 0.00125, outputPer1K: 0.01 }
    }
  },
  groq: {
    label: 'Groq',
    keyEnv: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    api: 'openai',
    models: {
      'llama-3.3-70b-versatile': { inputPer1K: 0.00059, outputPer1K: 0.00079 },
      'llama-3.1-8b-instant': { inputPer1K: 0.00005, outputPer1K: 0.00008 }
    }
  },
  openrouter: {
    label: 'OpenRouter',
    keyEnv: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    api: 'openai',
    models: {
      'openai/gpt-4o-mini': { inputPer1K: 0.00015, outputPer1K: 0.0006 },
      'anthropic/claude-sonnet-4-5': { inputPer1K: 0.003, outputPer1K: 0.015 },
      'openrouter/auto': { inputPer1K: 0.0005, outputPer1K: 0.002 }
    }
  },
  nvidia_nim: {
    label: 'NVIDIA NIM',
    keyEnv: 'NVIDIA_API_KEY',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    api: 'openai',
    models: {
      'meta/llama-3.3-70b-instruct': { inputPer1K: 0.0006, outputPer1K: 0.0008 },
      'meta/llama-3.1-8b-instruct': { inputPer1K: 0.00005, outputPer1K: 0.00008 }
    }
  },
  ollama: {
    label: 'Ollama',
    keyEnv: 'OLLAMA_ENABLED',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.1',
    api: 'openai',
    models: {
      'llama3.1': { inputPer1K: 0, outputPer1K: 0 },
      'llama3.2': { inputPer1K: 0, outputPer1K: 0 }
    }
  },
  lm_studio: {
    label: 'LM Studio',
    keyEnv: 'LM_STUDIO_ENABLED',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    api: 'openai',
    models: {
      'local-model': { inputPer1K: 0, outputPer1K: 0 },
      'default': { inputPer1K: 0, outputPer1K: 0 }
    }
  }
};

const DEFAULT_POLICY = {
  orchestrator: { provider: 'gemini', model: 'gemini-2.0-flash' },
  prospecting: { provider: 'gemini', model: 'gemini-2.0-flash' },
  market_intelligence: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  qualification: { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  outreach: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  strategist: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  marketer: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  sales: { provider: 'openai', model: 'gpt-4o-mini' },
  negotiator: { provider: 'openai', model: 'gpt-5' },
  treasurer: { provider: 'openai', model: 'gpt-4o-mini' },
  gatekeeper: { provider: 'groq', model: 'llama-3.1-8b-instant' },
  closing: { provider: 'openai', model: 'gpt-4o-mini' },
  intelligence: { provider: 'openai', model: 'gpt-4o-mini' }
};

const FALLBACK_CHAIN = ['openrouter', 'openai', 'groq', 'anthropic', 'gemini', 'nvidia_nim', 'ollama', 'lm_studio'];

function isConfigured(providerKey) {
  const p = PROVIDERS[providerKey];
  if (!p) return false;
  if (p.keyEnv === null || p.keyEnv === undefined) return true;
  return Boolean(process.env[p.keyEnv]);
}

function configuredProviders() {
  return Object.keys(PROVIDERS).filter(isConfigured);
}

function resolveModel(providerKey, model) {
  const p = PROVIDERS[providerKey];
  if (!p) return 'unknown';
  if (model && p.models[model]) return model;
  return p.defaultModel;
}

function pricing(providerKey, model) {
  const p = PROVIDERS[providerKey];
  if (!p || !p.models[model]) return { inputPer1K: 0, outputPer1K: 0 };
  return p.models[model];
}

function estimateTokens(prompt) {
  return Math.max(1, Math.ceil(String(prompt).length / 4));
}

function estimateOutputTokens(seed) {
  return 80 + (seed % 120);
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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
  const confidence = 65 + (seed % 30);
  const impact = 10 + (seed % 40);
  const trimmed = String(prompt).length > 80 ? String(prompt).slice(0, 80) + '…' : String(prompt);
  const outputTokens = estimateOutputTokens(seed);
  const inputTokens = estimateTokens(prompt);
  return {
    text: `[simulated ${PROVIDERS[providerKey].label} · ${model}]\nAnalysis: ${trimmed}\n\nRecommended action: ${next}.\nConfidence ${confidence}%. Estimated impact: +${impact}% pipeline contribution.`,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    simulated: true
  };
}

async function realCall(providerKey, model, prompt, opts) {
  const p = PROVIDERS[providerKey];
  const o = opts || {};
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
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
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
}

function costFromTokens(providerKey, model, inputTokens, outputTokens) {
  const pr = pricing(providerKey, model);
  const dollars = (inputTokens / 1000) * pr.inputPer1K + (outputTokens / 1000) * pr.outputPer1K;
  return Math.round(dollars * 100);
}

async function ensurePolicies(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const existing = await repos.providerPolicies.list(workspaceId);
  const keys = new Set(existing.map(e => e.agent_type));
  for (const [agentType, route] of Object.entries(DEFAULT_POLICY)) {
    if (!keys.has(agentType)) {
      await repos.providerPolicies.set(workspaceId, agentType, route.provider, route.model);
    }
  }
}

async function getPolicy(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const rows = await repos.providerPolicies.list(workspaceId);
  const policy = {};
  for (const r of rows) policy[r.agent_type] = { provider: r.provider, model: r.model || null };
  return policy;
}

async function resolveRoute(adapter, workspaceId, agentType) {
  const policy = await getPolicy(adapter, workspaceId);
  const route = policy[agentType] || DEFAULT_POLICY[agentType] || { provider: 'openai', model: 'gpt-4o-mini' };
  const model = resolveModel(route.provider, route.model);
  if (isConfigured(route.provider)) {
    return { provider: route.provider, model, fallback: null };
  }
  for (const candidate of FALLBACK_CHAIN) {
    if (candidate === route.provider) continue;
    if (isConfigured(candidate)) {
      return { provider: candidate, model: PROVIDERS[candidate].defaultModel, fallback: route.provider };
    }
  }
  return { provider: route.provider, model, fallback: null, simulated: true };
}

async function generate(adapter, workspaceId, agentType, prompt, opts) {
  const o = opts || {};
  let route;
  if (o.provider && PROVIDERS[o.provider]) {
    const model = resolveModel(o.provider, o.model || PROVIDERS[o.provider].defaultModel);
    route = { provider: o.provider, model, fallback: null, simulated: !isConfigured(o.provider) };
  } else {
    route = await resolveRoute(adapter, workspaceId, agentType);
  }
  let result;
  if (!route.simulated && o.simulate !== true) {
    try {
      result = await realCall(route.provider, route.model, prompt, o);
    } catch (err) {
      const fallbackCandidates = FALLBACK_CHAIN.filter(c => c !== route.provider && isConfigured(c));
      if (fallbackCandidates.length) {
        const fb = PROVIDERS[fallbackCandidates[0]];
        result = await realCall(fallbackCandidates[0], fb.defaultModel, prompt, o);
        route.provider = fallbackCandidates[0];
        route.model = fb.defaultModel;
        route.fallback = route.fallback || 'fallback';
      } else {
        result = simulate(agentType, prompt, route.provider, route.model);
        result.simulated = true;
        result.real_error = err.message;
      }
    }
  } else {
    result = simulate(agentType, prompt, route.provider, route.model);
  }
  const costCents = costFromTokens(route.provider, route.model, result.input_tokens, result.output_tokens);
  const repos = createRepos(adapter);
  await repos.usage.record({
    workspace_id: workspaceId,
    provider: route.provider,
    model: route.model,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    cost_cents: costCents
  });
  return {
    text: result.text,
    provider: route.provider,
    provider_label: PROVIDERS[route.provider].label,
    model: route.model,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    cost_cents: costCents,
    simulated: result.simulated,
    fallback: route.fallback,
    real_error: result.real_error || null
  };
}

module.exports = {
  PROVIDERS,
  DEFAULT_POLICY,
  FALLBACK_CHAIN,
  isConfigured,
  configuredProviders,
  resolveModel,
  ensurePolicies,
  getPolicy,
  resolveRoute,
  generate,
  simulate,
  hash,
  costFromTokens
};
