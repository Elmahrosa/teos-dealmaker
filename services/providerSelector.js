// services/providerSelector.js
// Provider selection logic and routing

const { PROVIDERS, DEFAULT_POLICY, FALLBACK_CHAIN, isConfigured, resolveModel } = require('./providerConfig');

function resolveRoute(adapter, workspaceId, agentType, overrideProvider = null, overrideModel = null) {
  // Get workspace-specific policy if available
  const getPolicy = async (adapter, workspaceId) => {
    const repos = require('../db/repos').createRepos(adapter);
    const rows = await repos.providerPolicies.list(workspaceId);
    const policy = {};
    for (const r of rows) policy[r.agent_type] = { provider: r.provider, model: r.model || null };
    return policy;
  };

  // If provider override is specified, use it
  if (overrideProvider && overrideProvider !== null) {
    const model = resolveModel(overrideProvider, overrideModel || null);
    const simulated = !isConfigured(overrideProvider);
    return { provider: overrideProvider, model, fallback: null, simulated };
  }

  // Otherwise, resolve route based on workspace policy and fallbacks
  return async function _resolveRoute(adapter, workspaceId, agentType) {
    const policy = await getPolicy(adapter, workspaceId);
    const route = policy[agentType] || DEFAULT_POLICY[agentType] || { provider: 'openai', model: 'gpt-4o-mini' };
    const model = resolveModel(route.provider, route.model);

    if (isConfigured(route.provider)) {
      return { provider: route.provider, model, fallback: null };
    }

    // Try fallbacks
    for (const candidate of FALLBACK_CHAIN) {
      if (candidate === route.provider) continue;
      if (isConfigured(candidate)) {
        const model = PROVIDERS[candidate].defaultModel;
        return { provider: candidate, model, fallback: route.provider };
      }
    }

    // If nothing is configured, use simulation
    return { provider: route.provider, model, fallback: null, simulated: true };
  }(adapter, workspaceId, agentType);
}

module.exports = {
  resolveRoute
};
