const registry = require('./registry');
const policy = require('./policy');
const client = require('./client');
const adapters = require('./adapters');
const pm = require('../plugin-manager').pluginManager;
const { createCivicMixerAdapter } = require('./adapters/civicMixer');
const { createPlatform } = require('../platform');

// Plugin permissions are enforced here as a policy rule: a request for a tool
// whose owning plugin has lost a required permission is denied before any
// adapter is reached.
policy.addRule((request) => {
  const decision = pm.permissions.check(request.toolId, request);
  return decision.allowed ? null : { allowed: false, reason: decision.reason };
});

const adapter = createCivicMixerAdapter();
pm.loadPlugins();
syncPluginTools();
const effectiveAdapter = pm.fallbackAdapter() || adapter;
adapters.setFallback(effectiveAdapter);
const platform = createPlatform();
const defaultClient = client.createClient({ registry, policy, adapter: effectiveAdapter, adapters, platform });

function syncPluginTools() {
  for (const tool of pm.tools()) {
    if (registry.isKnown(tool.toolId)) continue;
    registry.register({
      toolId: tool.toolId,
      server: tool.server,
      category: tool.category || 'plugin',
      description: tool.description || '',
      version: tool.version,
      capabilities: tool.capabilities || [],
      operations: tool.operations || []
    });
  }
  return registry.list().length;
}

function loadPlugins(dir) {
  const result = pm.loadPlugins(dir);
  syncPluginTools();
  return result;
}

function registerPlugin(dir) {
  const record = pm.register(dir);
  syncPluginTools();
  return record;
}

module.exports = {
  registry,
  policy,
  adapter: effectiveAdapter,
  adapters,
  plugins: pm,
  pluginManager: pm,
  platform,
  client,
  createClient: client.createClient,
  createAdapter: createCivicMixerAdapter,
  call: defaultClient.call,
  execute: defaultClient.call,
  health: defaultClient.health,
  discover: defaultClient.discover,
  listTools: defaultClient.listTools,
  registerTool: defaultClient.registerTool,
  unregisterTool: defaultClient.unregisterTool,
  isEnabled: client.isEnabled,
  getTool: registry.get,
  isKnown: registry.isKnown,
  versionOf: registry.versionOf,
  servers: registry.servers,
  capabilities: registry.capabilities,
  registerAdapter: adapters.register,
  loadPlugins,
  registerPlugin,
  validatePlugin: pm.validateManifest,
  enablePlugin: pm.enable,
  disablePlugin: pm.disable,
  discoverPlugins: pm.discover,
  pluginCapabilities: pm.capabilities,
  pluginStatus: pm.status,
  isPluginEnabled: pm.isEnabled,
  grantPluginPermission: pm.permissions.grant,
  revokePluginPermission: pm.permissions.revoke,
  hasPluginPermission: pm.permissions.has,
  pluginPermissions: pm.permissions.list,
  syncPluginTools
};
