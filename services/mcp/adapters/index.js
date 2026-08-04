const { createCivicMixerAdapter } = require('./civicMixer');

const byServer = new Map();
let fallback = null;

function setFallback(adapter) {
  fallback = adapter;
}

function register(server, adapter) {
  if (!server || !adapter) throw new Error('adapter registration requires a server key and an adapter');
  byServer.set(server, adapter);
  return adapter;
}

function get(server) {
  return byServer.get(server) || fallback || null;
}

function unregister(server) {
  byServer.delete(server);
}

function list() {
  return Array.from(byServer.keys());
}

module.exports = { register, get, unregister, list, setFallback, createCivicMixerAdapter };
