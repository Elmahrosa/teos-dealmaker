const { CONNECTORS } = require('./catalog');
const adapterUtil = require('./adapter');

async function runSync(adapter, workspaceId) {
  const repos = require('../../db/repos').createRepos(adapter);
  const rows = await repos.integrations.list(workspaceId);
  const enabled = rows.filter(r => r.status === 'enabled');
  const summary = { connectors: [], docs_written: 0, deals_upserted: 0, audits: 0 };

  for (const row of enabled) {
    const c = CONNECTORS[row.connector_id];
    if (!c) continue;
    const entry = { connector: row.connector_id, label: c.label, category: c.category, actions: [] };
    try {
      if (c.category === 'crm') {
        const deals = await adapterUtil.execute(adapter, workspaceId, row.connector_id, 'searchDeals', {});
        for (const d of deals.items || []) {
          const existing = await repos.deals.list(workspaceId, {});
          const match = existing.find(e => e.company_name === d.company);
          if (match) {
            await repos.deals.update(workspaceId, match.id, { stage: d.stage, deal_value: d.value, status: d.status });
          } else {
            await repos.deals.create({
              workspace_id: workspaceId,
              company_name: d.company,
              stage: d.stage,
              status: d.status,
              deal_value: d.value,
              currency: 'USD',
              current_agent: null
            });
            summary.deals_upserted += 1;
          }
        }
        const contacts = await adapterUtil.execute(adapter, workspaceId, row.connector_id, 'searchContacts', {});
        const body = [
          `Synced from ${c.label} at ${new Date().toISOString()}`,
          '',
          'DEALS',
          ...(deals.items || []).map(d => `${d.company}: ${d.stage} · $${d.value}`),
          '',
          'CONTACTS',
          ...(contacts.items || []).map(p => `${p.name} · ${p.email} · ${p.company}`)
        ].join('\n');
        await syncDocument(adapter, workspaceId, 'crm_data', `CRM Pipeline (from ${c.label})`, body);
        summary.docs_written += 1;
        entry.actions.push('deals', 'contacts', 'intelligence');
      } else if (c.category === 'email') {
        const sent = await adapterUtil.execute(adapter, workspaceId, row.connector_id, 'sendMessage', {
          to: 'internal-sync@teos.ai', subject: 'TEOS sync check', body: 'Integration hub sync heartbeat.'
        });
        entry.actions.push('sendCheck:' + sent.status);
      } else if (c.category === 'calendar') {
        const meeting = await adapterUtil.execute(adapter, workspaceId, row.connector_id, 'createMeeting', {
          title: 'TEOS integration test', start: new Date(Date.now() + 86400000).toISOString(), end: new Date(Date.now() + 86400000 + 3600000).toISOString()
        });
        entry.actions.push('meeting:' + (meeting.meetingId ? 'ok' : 'failed'));
      } else if (c.category === 'storage') {
        const stored = await adapterUtil.execute(adapter, workspaceId, row.connector_id, 'storeDocument', {
          title: 'TEOS-sync-manifest', content: 'Synced by the Enterprise Integration Hub at ' + new Date().toISOString()
        });
        entry.actions.push('file:' + (stored.fileId ? 'ok' : 'failed'));
      } else if (c.category === 'website') {
        const domain = (row.config && row.config.domain) || 'teos.ai';
        const crawl = await adapterUtil.execute(adapter, workspaceId, row.connector_id, 'crawl', { domain });
        const body = [
          `Crawl of ${domain} at ${new Date().toISOString()}`,
          `Pages scanned: ${crawl.pages}`,
          '',
          'FAQS',
          ...(crawl.faqs || []).map(f => `Q: ${f.question}\nA: ${f.answer}`),
          '',
          'PRODUCTS',
          ...(crawl.products || []).map(p => `${p.name} (${p.category})`)
        ].join('\n');
        await syncDocument(adapter, workspaceId, 'website', `Website Intelligence (${domain})`, body);
        await syncDocument(adapter, workspaceId, 'faqs', `FAQs from ${domain}`, (crawl.faqs || []).map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n'));
        await syncDocument(adapter, workspaceId, 'products', `Products from ${domain}`, (crawl.products || []).map(p => `${p.name}: ${p.category}`).join('\n'));
        summary.docs_written += 3;
        entry.actions.push('crawl', 'intelligence');
      } else if (c.category === 'communication') {
        const sent = await adapterUtil.execute(adapter, workspaceId, row.connector_id, 'sendMessage', {
          to: 'sync', body: 'TEOS integration hub is connected.'
        });
        entry.actions.push('ping:' + sent.status);
      }
    } catch (err) {
      entry.error = err.message;
    }
    await repos.integrations.upsert(workspaceId, row.connector_id, { last_synced_at: new Date().toISOString() });
    summary.audits += 1;
    summary.connectors.push(entry);
  }

  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'orchestrator',
    action_type: 'INTEGRATION_SYNC',
    details: { connectors: summary.connectors.length, docs_written: summary.docs_written, deals_upserted: summary.deals_upserted, version: 'v0.7.0' },
    version: 'v0.7.0'
  });
  summary.audits += 1;
  return summary;
}

async function syncDocument(adapter, workspaceId, sourceType, title, content) {
  const repos = require('../../db/repos').createRepos(adapter);
  const existing = await repos.intelligence.list(workspaceId, sourceType);
  const syncDoc = existing.find(d => d.metadata && d.metadata.synced && d.title === title);
  if (syncDoc) {
    await repos.intelligence.update(workspaceId, syncDoc.id, { content });
    return syncDoc.id;
  }
  const doc = await repos.intelligence.add({
    workspace_id: workspaceId,
    title,
    source_type: sourceType,
    content,
    metadata: { synced: true }
  });
  return doc.id;
}

module.exports = { runSync, syncDocument };
