const cache = new Map();

function key(workspaceId, connectorId, k) {
  return `${workspaceId}:${connectorId}:${k}`;
}

function get(workspaceId, connectorId, k) {
  const entry = cache.get(key(workspaceId, connectorId, k));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key(workspaceId, connectorId, k));
    return null;
  }
  return entry.value;
}

function set(workspaceId, connectorId, k, value, ttlMs = 30000) {
  cache.set(key(workspaceId, connectorId, k), { value, expiresAt: Date.now() + ttlMs });
  return value;
}

function clear(workspaceId) {
  let cleared = 0;
  for (const k of cache.keys()) {
    if (k.startsWith(`${workspaceId}:`)) {
      cache.delete(k);
      cleared += 1;
    }
  }
  return cleared;
}

function size() {
  return cache.size;
}

module.exports = { get, set, clear, size };
