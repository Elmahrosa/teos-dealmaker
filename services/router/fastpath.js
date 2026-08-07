'use strict';

const STATIC_INTENTS = new Set(['greeting', 'help', 'unknown']);
const CACHED_INTENTS = new Set(['status', 'analytics', 'revenue', 'deals', 'missions', 'approvals']);

function classify(intent) {
  if (STATIC_INTENTS.has(intent)) {
    return { path: 'fast', static: true, cached: false };
  }
  if (CACHED_INTENTS.has(intent)) {
    return { path: 'fast', static: false, cached: true };
  }
  return { path: 'slow', static: false, cached: false };
}

function staticResult(intent, detection, ctx) {
  switch (intent) {
    case 'greeting':
      return { action: 'greeting', data: { language: detection.language } };
    case 'help':
      return { action: 'help', data: { language: detection.language, isFounder: !!ctx.isFounder } };
    default:
      return { action: 'unknown', data: { language: detection.language, isFounder: !!ctx.isFounder } };
  }
}

module.exports = { classify, staticResult, STATIC_INTENTS, CACHED_INTENTS };
