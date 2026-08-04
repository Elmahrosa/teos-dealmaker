// services/platform/policies/sentinel.js
// Sentinel governance policy pack. Registers the Sentinel Shield governance
// rules directly on the Platform Policy Engine, making Sentinel the enterprise
// governance engine: every capability execution passes through these rules at
// the platform gate — the plugin's own policy.js remains as defense-in-depth.
'use strict';

const PACK_ID = 'sentinel';
const RULES = [
  {
    id: 'sentinel.workspace_required',
    name: 'Sentinel governance requires a workspace',
    scope: 'sentinel.scan|sentinel.audit',
    priority: 10,
    fn: (request) => {
      if (!request.capability || !['sentinel.scan', 'sentinel.audit'].includes(request.capability)) return null;
      if (!request.workspaceId) return { allowed: false, reason: 'sentinel_workspace_required' };
      return null;
    }
  },
  {
    id: 'sentinel.tool_required',
    name: 'Sentinel policy check requires a target tool',
    scope: 'sentinel.policy.check',
    priority: 10,
    fn: (request) => {
      if (!request.capability || request.capability !== 'sentinel.policy.check') return null;
      if (!request.payload || !request.payload.toolId) return { allowed: false, reason: 'sentinel_tool_required' };
      return null;
    }
  }
];

function createSentinelPolicyPack(engine) {
  const results = RULES.map((rule) => engine.register(rule));
  return { ok: results.every((r) => r.ok), id: PACK_ID, rules: results.length };
}

module.exports = { createSentinelPolicyPack, PACK_ID, RULES };
