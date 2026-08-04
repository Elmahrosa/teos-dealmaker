'use strict';
module.exports = {
  rules: [
    (request) => (request.toolId === 'sentinel.scan' && !request.workspaceId
      ? { allowed: false, reason: 'sentinel_workspace_required' }
      : null),
    (request) => (request.toolId === 'sentinel.audit' && !request.workspaceId
      ? { allowed: false, reason: 'sentinel_workspace_required' }
      : null),
    (request) => (request.toolId === 'sentinel.policy.check' && !(request.payload && request.payload.toolId)
      ? { allowed: false, reason: 'sentinel_tool_required' }
      : null)
  ]
};
