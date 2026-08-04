// services/platform/policies/engine.js
// Policy engine: the single enforcement point for capability execution. Wraps
// the registry + evaluator + audit so every evaluation is recorded. Composed by
// createPolicyEngine; the platform facade consults it after authorization.
'use strict';

function createEngine({ registry, evaluator, audit }) {
  async function evaluate(request) {
    const result = await evaluator.evaluate(request);
    if (audit) {
      try {
        await audit.write(result, request);
      } catch (_) {
        /* audit failure never changes the decision */
      }
    }
    return result;
  }

  return {
    evaluate,
    register: registry.register,
    unregister: registry.unregister,
    enable: registry.enable,
    disable: registry.disable,
    list: registry.list,
    get: registry.get
  };
}

module.exports = { createEngine };
