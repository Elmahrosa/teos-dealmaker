const mcp = require('../mcp');
const audit = require('../../utils/auditLogger');

async function requestTool(adapter, workspaceId, toolId, payload) {
  const result = await mcp.call(toolId, payload || {}, { requester: 'workforce', workspaceId });
  try {
    audit.writeEntry(
      result.ok ? 'MCP_TOOL_OK' : 'MCP_TOOL_FAIL',
      String(workspaceId || 'system'),
      result.ok ? 'success' : 'error',
      { toolId, reason: result.reason || result.error || 'ok' }
    );
  } catch (_) { /* audit must never block a tool call */ }
  return result;
}

module.exports = { requestTool };
