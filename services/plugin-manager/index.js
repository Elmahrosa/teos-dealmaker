// services/plugin-manager/index.js
// Plugin platform facade. This is the generic, transport-agnostic plugin
// platform: it owns loading, lifecycle, permissions, dependency resolution,
// capability discovery, and the event bus. It knows nothing about MCP, HTTP,
// gRPC, or any specific transport — MCP (and future transports) consume it.
//
// The default instance is created here; callers use it via
// `require('./plugin-manager').pluginManager` or create an isolated instance
// with createPluginManager({ ... }).
'use strict';

const path = require('path');

const { createBus, EVENT_NAMES } = require('./events');
const compat = require('./compatibility');
const perms = require('./permissions');
const lifecycle = require('./lifecycle');
const { createRegistry } = require('./registry');
const { createLoader } = require('./loader');

function defaultPluginsDir() {
  return path.join(__dirname, '..', '..', 'plugins');
}

function currentEngineVersion() {
  try {
    return require('../../package.json').version;
  } catch (_) {
    return '0.0.0';
  }
}

function createPluginManager(opts) {
  const o = opts || {};
  const registry = o.registry || createRegistry();
  const bus = o.bus || createBus();
  const engineVersion = o.engineVersion || currentEngineVersion();
  const defaultDir = o.pluginsDir || defaultPluginsDir();
  const loader = createLoader({ registry, bus, engineVersion, defaultDir });

  function check(toolId, request) {
    const record = registry.getByTool(toolId);
    if (!record) return { allowed: true };
    const tool = (record.tools || []).find((t) => t.toolId === toolId);
    const required = tool && Array.isArray(tool.permissions) ? tool.permissions : [];
    for (const key of required) {
      if (!perms.has(record.permissions, key)) {
        return { allowed: false, reason: 'plugin_permission_denied', capability: key };
      }
    }
    const policyRequest = Object.assign({}, request, { toolId });
    for (const rule of record.policyRules) {
      let decision = null;
      try {
        decision = rule(policyRequest);
      } catch (_) {
        /* a misbehaving plugin policy rule must not block the platform */
      }
      if (decision && decision.allowed === false) {
        return { allowed: false, reason: decision.reason || 'plugin_policy_denied', plugin: record.id };
      }
    }
    return { allowed: true };
  }

  function grant(id, key) {
    const record = registry.get(id);
    if (!record) return { ok: false, reason: 'unknown_plugin' };
    perms.grant(record.permissions, key);
    return { ok: true, id, capability: key, granted: true };
  }

  function revoke(id, key) {
    const record = registry.get(id);
    if (!record) return { ok: false, reason: 'unknown_plugin' };
    perms.revoke(record.permissions, key);
    return { ok: true, id, capability: key, granted: false };
  }

  function has(id, key) {
    const record = registry.get(id);
    return record ? perms.has(record.permissions, key) : false;
  }

  function permissionList(id) {
    const record = registry.get(id);
    return record ? perms.granted(record.permissions) : [];
  }

  function enable(id) {
    const record = registry.get(id);
    if (!record) return { ok: false, reason: 'unknown_plugin' };
    lifecycle.enable(record);
    return { ok: true, id, enabled: record.state !== lifecycle.STATES.DISABLED };
  }

  function disable(id) {
    const record = registry.get(id);
    if (!record) return { ok: false, reason: 'unknown_plugin' };
    lifecycle.disable(record);
    return { ok: true, id, enabled: false };
  }

  function isEnabled(id) {
    const record = registry.get(id);
    return record ? record.state !== lifecycle.STATES.DISABLED : false;
  }

  function status(id) {
    const record = registry.get(id);
    if (!record) return null;
    return {
      id: record.id,
      name: record.name,
      version: record.version,
      state: record.state,
      enabled: record.state !== lifecycle.STATES.DISABLED,
      server: record.server,
      fallback: record.fallback,
      tools: record.tools.map((t) => t.toolId),
      requires: record.requires,
      optional: record.optional,
      permissions: perms.granted(record.permissions),
      lastError: record.lastError
    };
  }

  function discover() {
    return registry.list()
      .map((record) => ({
        id: record.id,
        name: record.name,
        version: record.version,
        description: record.description,
        state: record.state,
        enabled: record.state !== lifecycle.STATES.DISABLED,
        server: record.server,
        fallback: record.fallback,
        tools: record.tools.map((t) => t.toolId)
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function capabilities() {
    const unique = new Set();
    for (const record of registry.list()) {
      for (const cap of record.capabilities || []) unique.add(cap);
      for (const tool of record.tools || []) {
        for (const cap of tool.capabilities || []) unique.add(cap);
      }
    }
    return Array.from(unique).sort();
  }

  function tools() {
    const flat = [];
    for (const record of registry.list()) {
      for (const tool of record.tools || []) {
        flat.push(Object.assign({}, tool, {
          server: tool.server || record.server || record.id,
          version: tool.version || record.version
        }));
      }
    }
    return flat;
  }

  function transportAdapter(server) {
    for (const record of registry.list()) {
      if (record.adapter && record.server === server) {
        return record.state === lifecycle.STATES.DISABLED ? lifecycle.disabledAdapter(record.id) : record.adapter;
      }
    }
    const fallbackRecord = registry.list().find((r) => r.fallback && r.adapter);
    if (fallbackRecord) {
      return fallbackRecord.state === lifecycle.STATES.DISABLED ? lifecycle.disabledAdapter(fallbackRecord.id) : fallbackRecord.adapter;
    }
    return null;
  }

  function loadPlugins(dir) {
    const result = loader.loadPlugins(dir);
    const deps = loader.resolveDependencies();
    return Object.assign({}, result, { deps });
  }

  function register(dir) {
    const record = loader.register(dir);
    loader.resolveDependencies();
    return record;
  }

  function validateManifest(manifest, dir) {
    return loader.validateManifest(manifest, dir);
  }

  function healthCheck(id) {
    return lifecycle.healthCheck(registry.get(id));
  }

  function shutdown(id) {
    return lifecycle.shutdown(registry.get(id));
  }

  function subscribe(name, handler) {
    return bus.subscribe(name, handler);
  }

  function emit(name, payload) {
    return bus.emit(name, payload);
  }

  return {
    API_VERSION: compat.API_VERSION,
    registry,
    events: bus,
    EVENT_NAMES,
    loadPlugins,
    register,
    validateManifest,
    enable,
    disable,
    isEnabled,
    status,
    discover,
    capabilities,
    tools,
    transportAdapter,
    permissions: { grant, revoke, has, list: permissionList, check },
    healthCheck,
    shutdown,
    subscribe,
    emit
  };
}

const pluginManager = createPluginManager();

module.exports = { createPluginManager, pluginManager, createBus, EVENT_NAMES, API_VERSION: compat.API_VERSION };
