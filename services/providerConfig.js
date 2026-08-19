// services/providerConfig.js
// Configuration data and helper functions for providers

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
      'gpt-5': { inputPer1K: 0.00125, outputPerK: 0.01 }
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
      'openrouter/auto': { inputPerK: 0.0005, outputPerK: 0.002 }
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
      'meta/llama-3.1-8b-instruct': { inputPerK: 0.00005, outputPerK: 0.00008 }
    }
  },
  ollama: {
    label: 'Ollama',
    keyEnv: 'OLLAMA_ENABLED',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.1',
    api: 'openai',
    models: {
      'llama3.1': { inputPerK: 0, outputPerK: 0 },
      'llama3.2': { inputPerK: 0, outputPerK: 0 }
    }
  },
  lm_studio: {
    label: 'LM Studio',
    keyEnv: 'LM_STUDIO_ENABLED',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    api: 'openai',
    models: {
      'local-model': { inputPerK: 0, outputPerK: 0 },
      'default': { inputPerK: 0, outputPerK: 0 }
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
  if (!p || !p.models[model]) return { inputPerK: 0, outputPerK: 0 };
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

module.exports = {
  PROVIDERS,
  DEFAULT_POLICY,
  FALLBACK_CHAIN,
  isConfigured,
  configuredProviders,
  resolveModel,
  pricing,
  estimateTokens,
  estimateOutputTokens,
  hash
};
