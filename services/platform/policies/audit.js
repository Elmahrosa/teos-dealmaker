// services/platform/policies/audit.js
// Policy decision audit. Records every evaluation in memory and, when a repos
// layer is available, persists decisions to the existing audit trail
// (repos.audit.add) with action_type POLICY_ALLOW / POLICY_DENY.
'use strict';

function createPolicyAudit(repos, opts) {
  const o = opts || {};
  const entries = [];
  const persist = o.persist !== undefined ? Boolean(o.persist) : Boolean(repos && repos.audit);

  async function write(result, request) {
    const entry = {
      at: result.at,
      decision: result.decision,
      allowed: result.allowed,
      reason: result.reason,
      policy: result.policy,
      rule: result.rule,
      capability: request.capability || null,
      workspaceId: request.workspaceId || null,
      userId: request.userId || null,
      requester: request.requester || null,
      trace: result.trace || []
    };
    entries.push(entry);
    if (persist && repos && repos.audit) {
      try {
        await repos.audit.add({
          workspace_id: request.workspaceId || null,
          user_id: request.userId || null,
          agent_name: 'platform',
          action_type: result.allowed ? 'POLICY_ALLOW' : 'POLICY_DENY',
          details: {
            capability: request.capability || null,
            decision: result.decision,
            reason: result.reason,
            policy: result.policy,
            rule: result.rule,
            trace: result.trace || []
          }
        });
      } catch (_) {
        /* audit must never block an evaluation */
      }
    }
    return entry;
  }

  function list() {
    return entries.slice();
  }

  return { write, list };
}

module.exports = { createPolicyAudit };
