const mcp = require('../mcp');
const audit = require('../../utils/auditLogger');

async function executeCapability(adapter, workspaceId, toolId, payload) {
  const result = await mcp.call(toolId, payload || {}, { requester: 'workforce', workspaceId });
  try {
    // Execution mode is explicit on every result (client contract): a
    // simulated success (MCP disabled / not configured) must never be logged
    // as a completed real run. It is recorded under its own event so audit
    // readers can tell "declared, not executed" apart from genuine success.
    const execution = result.execution || (result.simulated === true ? 'simulated' : result.ok ? 'live' : 'none');
    const simulated = execution === 'simulated';
    audit.writeEntry(
      simulated ? 'MCP_TOOL_SIMULATED' : result.ok ? 'MCP_TOOL_OK' : 'MCP_TOOL_FAIL',
      String(workspaceId || 'system'),
      simulated ? 'info' : result.ok ? 'success' : 'error',
      { toolId, execution, reason: result.reason || result.error || 'ok' }
    );
  } catch (_) { /* audit must never block a tool call */ }
  return result;
}

module.exports = { executeCapability };
