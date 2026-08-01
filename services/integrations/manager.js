const { CATEGORIES, CONNECTORS, isConfigured } = require('./catalog');

async function status(adapter, workspaceId) {
  const repos = require('../../db/repos').createRepos(adapter);
  const rows = await repos.integrations.list(workspaceId);
  const byId = {};
  for (const r of rows) byId[r.connector_id] = r;
  return {
    categories: Object.keys(CATEGORIES).map(cat => ({
      category: cat,
      label: CATEGORIES[cat].label,
      connectors: Object.keys(CONNECTORS)
        .filter(id => CONNECTORS[id].category === cat)
        .map(id => {
          const c = CONNECTORS[id];
          const conn = byId[id];
          return {
            id,
            label: c.label,
            auth: c.auth,
            configured: isConfigured(id),
            enabled: Boolean(conn && conn.status === 'enabled'),
            status: conn ? conn.status : 'disconnected',
            last_synced_at: conn ? conn.last_synced_at || null : null
          };
        })
    })),
    enabled_total: rows.filter(r => r.status === 'enabled').length
  };
}

async function enable(adapter, workspaceId, connectorId) {
  const repos = require('../../db/repos').createRepos(adapter);
  if (!CONNECTORS[connectorId]) throw new Error('Unknown connector: ' + connectorId);
  const now = new Date().toISOString();
  const conn = await repos.integrations.upsert(workspaceId, connectorId, { status: 'enabled', last_synced_at: now });
  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'orchestrator',
    action_type: 'INTEGRATION_ENABLED',
    details: { connector: connectorId, label: CONNECTORS[connectorId].label, version: 'v0.7.0' },
    version: 'v0.7.0'
  });
  return conn;
}

async function disable(adapter, workspaceId, connectorId) {
  const repos = require('../../db/repos').createRepos(adapter);
  if (!CONNECTORS[connectorId]) throw new Error('Unknown connector: ' + connectorId);
  const conn = await repos.integrations.upsert(workspaceId, connectorId, { status: 'disabled' });
  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'orchestrator',
    action_type: 'INTEGRATION_DISABLED',
    details: { connector: connectorId, label: CONNECTORS[connectorId].label, version: 'v0.7.0' },
    version: 'v0.7.0'
  });
  return conn;
}

async function test(adapter, workspaceId, connectorId) {
  if (!CONNECTORS[connectorId]) return { ok: false, connector: connectorId, detail: 'Unknown connector' };
  const c = CONNECTORS[connectorId];
  if (isConfigured(connectorId)) {
    return { ok: true, connector: connectorId, label: c.label, detail: 'Connected (live key detected)', live: true };
  }
  return { ok: true, connector: connectorId, label: c.label, detail: 'Dry-run OK — no API key set, simulated', live: false };
}

module.exports = { status, enable, disable, test };
