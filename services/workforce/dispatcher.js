const providers = require('../providers');

const AGENT_ROUTES = {
  orchestrator: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'openai', model: 'gpt-4o-mini' }
  ],
  revenue_strategist: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'openai', model: 'gpt-4o-mini' }
  ],
  planner: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'openai', model: 'gpt-4o-mini' }
  ],
  prospecting: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' }
  ],
  market_intelligence: [
    { provider: 'gemini', model: 'gemini-2.0-flash' },
    { provider: 'openai', model: 'gpt-4o-mini' }
  ],
  intelligence: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' }
  ],
  research: [
    { provider: 'gemini', model: 'gemini-2.0-flash' },
    { provider: 'openai', model: 'gpt-4o-mini' }
  ],
  qualification: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' }
  ],
  outreach: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' }
  ],
  strategist: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'openai', model: 'gpt-4o-mini' }
  ],
  marketer: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' }
  ],
  sales: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' }
  ],
  negotiator: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'openai', model: 'gpt-4o-mini' }
  ],
  treasurer: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' }
  ],
  gatekeeper: [
    { provider: 'anthropic', model: 'claude-haiku-4-5' },
    { provider: 'openai', model: 'gpt-4o-mini' }
  ],
  closing: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' }
  ]
};

const DEFAULT_ROUTES = [{ provider: 'openai', model: 'gpt-4o-mini' }, { provider: 'groq', model: 'llama-3.3-70b-versatile' }];

const RETRY_POLICY = {
  orchestrator: { maxRetries: 2, backoffMs: 15 },
  planner: { maxRetries: 2, backoffMs: 15 },
  revenue_strategist: { maxRetries: 2, backoffMs: 15 },
  strategist: { maxRetries: 2, backoffMs: 15 },
  negotiator: { maxRetries: 2, backoffMs: 15 },
  treasurer: { maxRetries: 3, backoffMs: 20 },
  gatekeeper: { maxRetries: 2, backoffMs: 15 },
  closing: { maxRetries: 3, backoffMs: 20 },
  default: { maxRetries: 2, backoffMs: 10 }
};

const CONCURRENCY = {
  orchestrator: 1,
  planner: 1,
  revenue_strategist: 1,
  research: 4,
  market_intelligence: 3,
  prospecting: 4,
  intelligence: 3,
  qualification: 3,
  outreach: 4,
  strategist: 2,
  negotiator: 2,
  marketer: 2,
  sales: 2,
  treasurer: 1,
  gatekeeper: 2,
  closing: 1,
  default: 2
};

function routesFor(agentType) {
  return AGENT_ROUTES[agentType] || DEFAULT_ROUTES;
}

function retryPolicyFor(agentType) {
  return RETRY_POLICY[agentType] || RETRY_POLICY.default;
}

function concurrencyFor(agentType) {
  return CONCURRENCY[agentType] || CONCURRENCY.default;
}

function dispatch({ agentType, priority = 'normal', quality = 'balanced', opts }) {
  const o = opts || {};
  const routes = routesFor(agentType);
  if (o.provider && providers.PROVIDERS[o.provider]) {
    const model = providers.resolveModel(o.provider, o.model || providers.PROVIDERS[o.provider].defaultModel);
    return {
      provider: o.provider,
      model,
      simulated: !providers.isConfigured(o.provider),
      priority,
      retryPolicy: retryPolicyFor(agentType),
      concurrency: concurrencyFor(agentType),
      source: 'explicit'
    };
  }
  const configured = routes.filter(r => providers.isConfigured(r.provider));
  if (configured.length) {
    const pick = quality === 'cheap' ? configured[configured.length - 1] : configured[0];
    return {
      provider: pick.provider,
      model: providers.resolveModel(pick.provider, pick.model),
      simulated: false,
      priority,
      retryPolicy: retryPolicyFor(agentType),
      concurrency: concurrencyFor(agentType),
      source: 'configured'
    };
  }
  const fallback = routes[0];
  return {
    provider: fallback.provider,
    model: providers.resolveModel(fallback.provider, fallback.model),
    simulated: true,
    priority,
    retryPolicy: retryPolicyFor(agentType),
    concurrency: concurrencyFor(agentType),
    source: 'default'
  };
}

module.exports = {
  AGENT_ROUTES,
  DEFAULT_ROUTES,
  RETRY_POLICY,
  CONCURRENCY,
  routesFor,
  retryPolicyFor,
  concurrencyFor,
  dispatch
};
