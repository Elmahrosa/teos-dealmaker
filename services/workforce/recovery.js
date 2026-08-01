const providers = require('../providers');
const { emit, EVENT_NAMES } = require('./events');

async function withRetry(fn, { maxRetries = 2, backoffMs = 10, onRetry, onProviderFailure } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt <= maxRetries) {
        emit(EVENT_NAMES.TASK_RETRYING, { attempt, maxRetries, error: err.message });
        if (onProviderFailure) onProviderFailure(err);
        if (onRetry) onRetry(attempt, err);
        await new Promise(resolve => setTimeout(resolve, backoffMs * attempt));
      }
    }
  }
  throw lastError;
}

function fallbackChainFor(route) {
  const next = providers.FALLBACK_CHAIN.find(c => c !== (route && route.provider) && providers.isConfigured(c));
  return next
    ? { provider: next, model: providers.PROVIDERS[next].defaultModel, fallback: (route && route.provider) || null }
    : null;
}

const ESCALATION_STEPS = ['retry', 'fallback_model', 'fallback_provider', 'escalate_human'];

function escalationLevel(attempt, route) {
  if (attempt <= 1) return { level: 'retry', next: `retry up to ${Math.max(1, (route && route.retryPolicy ? route.retryPolicy.maxRetries : 2))} times` };
  const fallback = fallbackChainFor(route);
  if (attempt === 2 && fallback) return { level: 'fallback_provider', next: `${fallback.provider}/${fallback.model}` };
  return { level: 'escalate_human', next: 'notify the founder; workflow never dies silently' };
}

module.exports = { withRetry, fallbackChainFor, escalationLevel, ESCALATION_STEPS };
