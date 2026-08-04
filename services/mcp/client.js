function isEnabled() {
  return process.env.MCP_ENABLED === 'true';
}

function createClient(deps) {
  const o = deps || {};
  const registry = o.registry;
  const policy = o.policy;
  const adapter = o.adapter;
  const adapters = o.adapters;
  const enabled = o.enabled !== undefined ? Boolean(o.enabled) : isEnabled();

  function resolveAdapter(tool) {
    if (adapters && typeof adapters.get === 'function') {
      const selected = adapters.get(tool.server);
      if (selected) return selected;
    }
    return adapter || null;
  }

  async function call(toolId, payload, opts) {
    const options = opts || {};
    const requester = options.requester || 'system';
    const workspaceId = options.workspaceId || null;
    if (!enabled) {
      return { ok: true, toolId, simulated: true, reason: 'mcp_disabled', requester, workspaceId };
    }
    const tool = registry.get(toolId);
    if (!tool) {
      return { ok: false, toolId, error: 'unknown_tool', reason: 'unknown_tool', requester, workspaceId };
    }
    const decision = await policy.approve({ toolId, payload: payload || {}, requester, workspaceId });
    if (!decision.allowed) {
      return { ok: false, toolId, error: 'denied', reason: decision.reason, decision, requester, workspaceId };
    }
    const target = resolveAdapter(tool);
    if (!target) {
      return { ok: false, toolId, error: 'no_adapter', requester, workspaceId };
    }
    const adapterConfig = target.config ? target.config() : {};
    if (!adapterConfig.endpoint) {
      return { ok: true, toolId, simulated: true, reason: 'mcp_not_configured', requester, workspaceId };
    }
    const result = await target.call({ toolId, payload: payload || {}, requester, id: options.id || Date.now() });
    if (!result.ok) {
      return { ok: false, toolId, error: result.error, message: result.message, requester, workspaceId };
    }
    return { ok: true, toolId, data: result.data, simulated: false, requester, workspaceId };
  }

  async function health() {
    if (!enabled) return { ok: true, status: 'disabled', simulated: true };
    const adapterConfig = adapter && adapter.config ? adapter.config() : {};
    if (!adapterConfig.endpoint) return { ok: true, status: 'not_configured', simulated: true };
    const result = await adapter.health();
    return { ok: result.ok, status: result.status, latency_ms: result.latency_ms, simulated: false };
  }

  async function discover() {
    if (!enabled) return { ok: true, simulated: true, tools: registry.list() };
    const adapterConfig = adapter && adapter.config ? adapter.config() : {};
    if (!adapterConfig.endpoint) return { ok: true, simulated: true, tools: registry.list() };
    const result = await adapter.discover();
    if (!result.ok) return { ok: false, error: result.error, message: result.message };
    return { ok: true, tools: result.tools, simulated: false };
  }

  function listTools(filter) {
    return registry.list(filter);
  }

  function registerTool(def) {
    return registry.register(def);
  }

  function unregisterTool(toolId) {
    return registry.unregister(toolId);
  }

  return {
    call,
    execute: call,
    health,
    discover,
    listTools,
    registerTool,
    unregisterTool,
    isEnabled: () => enabled
  };
}

module.exports = { createClient, isEnabled };
