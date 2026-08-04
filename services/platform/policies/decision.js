// services/platform/policies/decision.js
// Policy decision model. A decision is a serializable record of a single
// evaluation: allowed/deny, the deciding policy/rule, the reason, and the
// full evaluation trace for auditability.
'use strict';

function decision(allowed, opts) {
  const o = opts || {};
  return {
    allowed: Boolean(allowed),
    decision: allowed ? 'allow' : 'deny',
    reason: o.reason || (allowed ? 'policy_allow' : 'policy_denied'),
    policy: o.policy || null,
    rule: o.rule || null,
    capability: o.capability || null,
    workspaceId: o.workspaceId || null,
    requester: o.requester || null,
    trace: o.trace || [],
    at: new Date().toISOString()
  };
}

module.exports = { decision };
