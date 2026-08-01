const { CONNECTORS } = require('./catalog');
const { hash } = require('../providers');

function verify(connectorId, payload, signature) {
  if (!CONNECTORS[connectorId]) return { ok: false, reason: 'unknown_connector' };
  const secret = process.env[`${connectorId.toUpperCase()}_WEBHOOK_SECRET`];
  if (!secret || !signature) return { ok: true, reason: 'no_secret_configured', simulated: true };
  const expected = `sha256=${hash(`${secret}|${JSON.stringify(payload)}`).toString(16)}`;
  return { ok: signature === expected, expected };
}

async function ingest(adapter, workspaceId, connectorId, event, payload) {
  const repos = require('../../db/repos').createRepos(adapter);
  const c = CONNECTORS[connectorId];
  if (!c) return { ok: false, reason: 'unknown_connector' };
  const conn = await repos.integrations.get(workspaceId, connectorId);
  if (!conn || conn.status !== 'enabled') {
    return { ok: false, reason: 'connector_not_enabled', connector: connectorId };
  }
  const body = [
    `Webhook from ${c.label} (${event}) at ${new Date().toISOString()}`,
    '',
    String(payload ? (payload.text || payload.subject || payload.body || JSON.stringify(payload)) : 'no payload')
  ].join('\n');
  const intelligence = require('../intelligence');
  await intelligence.addDocument(adapter, workspaceId, {
    title: `${c.label} · ${event} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    source_type: 'conversations',
    content: body,
    metadata: { webhook: connectorId, event }
  });
  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'orchestrator',
    action_type: 'INTEGRATION_WEBHOOK',
    details: { connector: connectorId, event, version: 'v0.7.0' },
    version: 'v0.7.0'
  });
  return { ok: true, connector: connectorId, event, source_type: 'conversations' };
}

module.exports = { verify, ingest };
