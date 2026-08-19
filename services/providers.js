// services/providers.js
// Refactored to follow Single Responsibility Principle by splitting concerns

const providerConfig = require('./providerConfig');
const providerSelector = require('./providerSelector');
const providerExecutor = require('./providerExecutor');
const { createRepos } = require('../db/repos');

const {
  PROVIDERS,
  DEFAULT_POLICY,
  FALLBACK_CHAIN,
  isConfigured,
  configuredProviders,
  resolveModel
} = providerConfig;

// Re-export for backward compatibility
module.exports = {
  PROVIDERS,
  DEFAULT_POLICY,
  FALLBACK_CHAIN,
  isConfigured,
  configuredProviders,
  resolveModel,
  ensurePolicies: async (adapter, workspaceId) => {
    const repos = createRepos(adapter);
    const existing = await repos.providerPolicies.list(workspaceId);
    const keys = new Set(existing.map(e => e.agent_type));
    for (const [agentType, route] of Object.entries(DEFAULT_POLICY)) {
      if (!keys.has(agentType)) {
        await repos.providerPolicies.set(workspaceId, agentType, route.provider, route.model);
      }
    }
  },
  getPolicy: async (adapter, workspaceId) => {
    const repos = createRepos(adapter);
    const rows = await repos.providerPolicies.list(workspaceId);
    const policy = {};
    for (const r of rows) policy[r.agent_type] = { provider: r.provider, model: r.model || null };
    return policy;
  },
  resolveRoute: (adapter, workspaceId, agentType) => providerSelector.resolveRoute(adapter, workspaceId, agentType),
  generate: async (adapter, workspaceId, agentType, prompt, opts) => {
    const o = opts || {};
    let route;
    if (o.provider && PROVIDERS[o.provider]) {
      const model = providerConfig.resolveModel(o.provider, o.model || PROVIDERS[o.provider].defaultModel);
      route = { provider: o.provider, model, fallback: null, simulated: !providerConfig.isConfigured(o.provider) };
    } else {
      route = await providerSelector.resolveRoute(adapter, workspaceId, agentType);
    }
    let result;
    if (!route.simulated && o.simulate !== true) {
      try {
        result = await providerExecutor.realCall(route.provider, route.model, prompt, o);
      } catch (err) {
        const fallbackCandidates = FALLBACK_CHAIN.filter(c => c !== route.provider && providerConfig.isConfigured(c));
        if (fallbackCandidates.length) {
          const fb = PROVIDERS[fallbackCandidates[0]];
          result = await providerExecutor.realCall(fallbackCandidates[0], fb.defaultModel, prompt, o);
          route.provider = fallbackCandidates[0];
          route.model = fb.defaultModel;
          route.fallback = route.fallback || 'fallback';
        } else {
          result = providerExecutor.simulate(agentType, prompt, route.provider, route.model);
          result.simulated = true;
          result.real_error = err.message;
        }
      }
    } else {
      result = providerExecutor.simulate(agentType, prompt, route.provider, route.model);
    }
    const costCents = providerExecutor.costFromTokens(route.provider, route.model, result.input_tokens, result.output_tokens);
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
  },
  simulate: providerExecutor.simulate,
  hash: providerExecutor.hash,
  costFromTokens: providerExecutor.costFromTokens
};
