// services/plugin-manager/registry.js
// In-memory store for loaded plugin records and the toolId -> plugin mapping
// used by capability/permission lookups. A plugin manager owns one registry.
'use strict';

function createRegistry() {
  const records = new Map();
  const toolOwner = new Map();

  return {
    set(record) {
      records.set(record.id, record);
      for (const tool of record.tools || []) {
        if (tool && tool.toolId) toolOwner.set(tool.toolId, record.id);
      }
    },
    get(id) {
      return records.get(id) || null;
    },
    has(id) {
      return records.has(id);
    },
    getByTool(toolId) {
      const ownerId = toolOwner.get(toolId);
      return ownerId ? records.get(ownerId) || null : null;
    },
    list() {
      return Array.from(records.values());
    },
    clear() {
      records.clear();
      toolOwner.clear();
    }
  };
}

module.exports = { createRegistry };
