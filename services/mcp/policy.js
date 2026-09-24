const audit = require('../../utils/auditLogger');

let allowList = null;
let denyList = new Set();
let workspaceAllowList = null;
const rules = [];

function setAllowList(toolIds) {
  allowList = Array.isArray(toolIds) && toolIds.length ? new Set(toolIds) : null;
}

function allowTool(toolId) {
  if (!allowList) allowList = new Set();
  allowList.add(toolId);
}

function denyTool(toolId) {
  denyList.add(toolId);
}

function allowWorkspaces(workspaceIds) {
  workspaceAllowList = Array.isArray(workspaceIds) && workspaceIds.length
    ? new Set(workspaceIds.map(String))
    : null;
}

function addRule(rule) {
  if (typeof rule !== 'function') throw new Error('MCP policy rule must be a function');
  rules.push(rule);
  return () => {
    const idx = rules.indexOf(rule);
    if (idx >= 0) rules.splice(idx, 1);
  };
}

function reset() {
  rules.length = 0;
  denyList = new Set();
  allowList = null;
  workspaceAllowList = null;
}

function decision(allowed, reason, request) {
  return {
    allowed,
    decision: allowed ? 'allow' : 'deny',
    reason,
    toolId: request.toolId,
    requester: request.requester || null,
    workspaceId: request.workspaceId || null
  };
}

function evaluate(request) {
  // Mandatory deny list wins over every other gate (deny-wins).
  if (denyList.has(request.toolId)) return decision(false, 'tool_denied', request);
  // Workspace allow list, when configured, is also mandatory.
  if (workspaceAllowList) {
    if (!request.workspaceId) return decision(false, 'workspace_required', request);
    if (!workspaceAllowList.has(String(request.workspaceId))) return decision(false, 'workspace_not_allowed', request);
  }
  // Fail-closed default: a tool may only execute when it has been explicitly
  // allow-listed. Missing policy configuration denies everything; a configured
  // allow list denies everything not on the list.
  if (!allowList || !allowList.has(request.toolId)) {
    return decision(false, allowList ? 'tool_not_in_allow_list' : 'policy_not_configured', request);
  }
  for (const rule of rules) {
    let ruleDecision = null;
    try {
      ruleDecision = rule(request);
    } catch (_) {
      // A malformed rule must fail safe: denied, never opened.
      return decision(false, 'policy_rule_error', request);
    }
    if (ruleDecision && ruleDecision.allowed === false) {
      return decision(false, ruleDecision.reason || 'denied_by_rule', request);
    }
  }
  return decision(true, 'policy_allow_all', request);
}

async function approve(request) {
  const result = evaluate(request);
  try {
    audit.writeEntry(
      result.allowed ? 'MCP_POLICY_ALLOW' : 'MCP_POLICY_DENY',
      String(request.requester || 'system'),
      result.allowed ? 'success' : 'denied',
      { toolId: request.toolId, decision: result.decision, reason: result.reason, workspaceId: request.workspaceId || null }
    );
  } catch (_) { /* audit must never block a tool call */ }
  return result;
}

module.exports = { approve, evaluate, addRule, reset, setAllowList, allowTool, denyTool, allowWorkspaces };
