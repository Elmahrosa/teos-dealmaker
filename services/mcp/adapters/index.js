const { createCivicMixerAdapter } = require('./civicMixer');
const pm = require('../../plugin-manager').pluginManager;

const byServer = new Map();
let fallback = null;

function setFallback(adapter) {
  fallback = adapter;
}

function getFallback() {
  return fallback;
}

function register(server, adapter) {
  if (!server || !adapter) throw new Error('adapter registration requires a server key and an adapter');
  byServer.set(server, adapter);
  return adapter;
}

function get(server) {
  const local = byServer.get(server);
  if (local) return local;
  const viaPlugin = pm.transportAdapter(server);
  if (viaPlugin) return viaPlugin;
  return fallback || null;
}

function unregister(server) {
  byServer.delete(server);
}

function list() {
  return Array.from(byServer.keys());
}

module.exports = { register, get, unregister, list, setFallback, getFallback, createCivicMixerAdapter };
