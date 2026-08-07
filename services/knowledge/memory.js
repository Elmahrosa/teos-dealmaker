'use strict';

const TTL = 60 * 1000;

const indexes = new Map();

function get(workspaceId) {
  const entry = indexes.get(String(workspaceId));
  if (entry && Date.now() - entry.at < TTL) return entry.docs;
  return null;
}

function set(workspaceId, docs) {
  indexes.set(String(workspaceId), { at: Date.now(), docs });
}

function invalidate(workspaceId) {
  indexes.delete(String(workspaceId));
}

function reset() {
  indexes.clear();
}

function stats() {
  return { workspaces: indexes.size, docs: [...indexes.values()].reduce((acc, e) => acc + e.docs.length, 0) };
}

module.exports = { get, set, invalidate, reset, stats, TTL };
