// services/platform/policies/index.js
// Platform Policy Engine. The single enforcement point for capability
// execution: executeCapability() -> Authorization -> Policy Engine -> Plugin
// -> MCP -> Provider. The Sentinel Shield governance pack is registered by
// default so governance rules run at the platform gate; the plugin's own
// policy.js remains as defense-in-depth.
'use strict';

const { decision } = require('./decision');
const { createRuleRegistry } = require('./registry');
const { createEvaluator } = require('./evaluator');
const { createPolicyAudit } = require('./audit');
const { createEngine } = require('./engine');
const { createSentinelPolicyPack, PACK_ID } = require('./sentinel');

function createPolicyEngine(opts) {
  const o = opts || {};
  const registry = o.registry || createRuleRegistry();
  const evaluator = o.evaluator || createEvaluator(registry);
  const audit = o.audit || createPolicyAudit(o.repos || null, o);
  const engine = createEngine({ registry, evaluator, audit });

  if (o.registerSentinelPolicy !== false) {
    createSentinelPolicyPack(engine);
  }

  return Object.assign(engine, {
    registry,
    evaluator,
    audit,
    packs: [PACK_ID],
    decision
  });
}

module.exports = {
  createPolicyEngine,
  createRuleRegistry,
  createEvaluator,
  createPolicyAudit,
  createSentinelPolicyPack,
  decision,
  PACK_ID
};
