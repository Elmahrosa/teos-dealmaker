const registry = require('./registry');
const policy = require('./policy');
const client = require('./client');
const adapters = require('./adapters');
const { createCivicMixerAdapter } = require('./adapters/civicMixer');

const adapter = createCivicMixerAdapter();
adapters.setFallback(adapter);
const defaultClient = client.createClient({ registry, policy, adapter, adapters });

module.exports = {
  registry,
  policy,
  adapter,
  adapters,
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
  registerAdapter: adapters.register
};
