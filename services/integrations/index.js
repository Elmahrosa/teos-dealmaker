const { CATEGORIES, CONNECTORS } = require('./catalog');
const adapter = require('./adapter');
const manager = require('./manager');
const oauth = require('./oauth');
const sync = require('./sync');
const webhooks = require('./webhooks');
const cache = require('./cache');
const { createRepos } = require('../../db/repos');
const intelligence = require('../intelligence');

function createIntegrations(adapterRef, workspaceId) {
  const enabledIds = async () => {
    const repos = createRepos(adapterRef);
    const rows = await repos.integrations.list(workspaceId);
    return rows.filter(r => r.status === 'enabled').map(r => r.connector_id);
  };

  const route = async (op, args, connectorId) => {
    const ids = await enabledIds();
    const pick = adapter.pickConnector(ids, connectorId, adapter.CAPABILITIES[op]);
    if (!pick) {
      const catKey = adapter.CAPABILITIES[op];
      const label = (CATEGORIES[catKey] || {}).label || catKey;
      return { items: [], total: 0, source: null, message: `No ${label} connector enabled — connect one in the Integration Hub.` };
    }
    const cachedKey = `${op}:${JSON.stringify(args || {})}`;
    const hit = cache.get(workspaceId, pick, cachedKey);
    if (hit) return hit;
    const result = await adapter.execute(adapterRef, workspaceId, pick, op, args);
    cache.set(workspaceId, pick, cachedKey, result, 15000);
    return result;
  };

  return {
    client: {
      async searchContacts(query, connectorId) { return route('searchContacts', { query }, connectorId); },
      async searchDeals(query, connectorId) { return route('searchDeals', { query }, connectorId); },
      async sendMessage(to, body, connectorId, opts) {
        const o = opts || {};
        return route('sendMessage', { to, body, subject: o.subject, from: o.from }, connectorId);
      },
      async createMeeting(title, start, end, connectorId, attendee) {
        return route('createMeeting', { title, start, end, attendee }, connectorId);
      },
      async storeDocument(title, content, connectorId) {
        return route('storeDocument', { title, content }, connectorId);
      },
      async crawl(domain, connectorId) {
        return route('crawl', { domain }, connectorId);
      },
      async fetchKnowledge(query, topK) {
        return intelligence.retrieve(adapterRef, workspaceId, query, { topK: topK || 4 });
      }
    },
    manager,
    oauth,
    cache,
    sync: () => sync.runSync(adapterRef, workspaceId),
    webhook: (connectorId, event, payload, signature) => {
      const v = webhooks.verify(connectorId, payload, signature);
      if (!v.ok) return Promise.resolve({ ok: false, reason: v.reason });
      return webhooks.ingest(adapterRef, workspaceId, connectorId, event, payload);
    },
    catalog: { CATEGORIES, CONNECTORS }
  };
}

module.exports = {
  createIntegrations,
  manager,
  oauth,
  webhooks,
  catalog: { CATEGORIES, CONNECTORS }
};
