// services/platform/policies/evaluator.js
// Rule evaluator. Fail-closed, deny-wins semantics: rules run in priority
// order; the first explicit deny short-circuits the evaluation; a rule that
// throws is treated as a deny (a broken policy must never open the gate). Every
// evaluation produces a decision carrying the full trace.
'use strict';

const { decision } = require('./decision');

function createEvaluator(registry) {
  async function evaluate(request) {
    const trace = [];
    for (const rule of registry.ordered()) {
      let result = null;
      try {
        result = await rule.fn(request);
      } catch (err) {
        result = { allowed: false, reason: 'policy_rule_error', error: err.message || 'error' };
      }
      if (result === null || result === undefined) continue;
      const granted = result.allowed !== false;
      trace.push({ rule: rule.id, scope: rule.scope, allowed: granted, reason: result.reason || null });
      if (!granted) {
        return decision(false, {
          reason: result.reason || 'policy_denied',
          policy: rule.id,
          rule: rule.id,
          capability: request.capability,
          workspaceId: request.workspaceId,
          requester: request.requester,
          trace
        });
      }
    }
    return decision(true, {
      reason: 'policy_allow_all',
      capability: request.capability,
      workspaceId: request.workspaceId,
      requester: request.requester,
      trace
    });
  }

  return { evaluate };
}

module.exports = { createEvaluator };
