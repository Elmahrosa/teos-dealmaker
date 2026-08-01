const providers = require('../providers');
const dispatcher = require('./dispatcher');

function estimateCostCents(providerKey, model, promptLen) {
  const p = providers.PROVIDERS[providerKey];
  if (!p || !p.models) return 0;
  const rates = p.models[model] || p.models[p.defaultModel];
  if (!rates) return 0;
  const inputTokens = Math.max(1, Math.ceil(promptLen / 4));
  const outputTokens = 80;
  return Math.max(1, Math.round((inputTokens / 1000) * rates.inputPer1K + (outputTokens / 1000) * rates.outputPer1K) * 100);
}

function optimize({ agentType, quality = 'balanced', promptLen = 500 }) {
  const routes = dispatcher.routesFor(agentType);
  const withCost = routes.map(r => ({ ...r, estCostCents: estimateCostCents(r.provider, r.model, promptLen) }));

  const configured = withCost.filter(r => providers.isConfigured(r.provider));
  if (configured.length) {
    if (quality === 'cheap') {
      configured.sort((a, b) => a.estCostCents - b.estCostCents);
      return { ...configured[0], simulated: false, source: 'cost_optimizer' };
    }
    if (quality === 'best') {
      return { ...configured[0], simulated: false, source: 'quality_optimizer' };
    }
    return { ...configured[0], simulated: false, source: 'balanced' };
  }

  const fallback = { ...withCost[0], simulated: true, source: 'cost_optimizer_default' };
  return fallback;
}

module.exports = { estimateCostCents, optimize };
