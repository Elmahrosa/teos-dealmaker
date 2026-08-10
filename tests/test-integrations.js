const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');
const intelligence = require('../services/intelligence');
const integrations = require('../services/integrations');
const { CATEGORIES, CONNECTORS, isConfigured, byCategory } = require('../services/integrations/catalog');
const adapterUtil = require('../services/integrations/adapter');
const oauth = require('../services/integrations/oauth');
const webhooks = require('../services/integrations/webhooks');
const cache = require('../services/integrations/cache');

const CATEGORY_COUNTS = { crm: 4, email: 4, calendar: 2, storage: 3, website: 2, communication: 3 };

(async () => {
  let n = 0;
  const check = (cond, msg) => { assert.ok(cond, msg); n += 1; };
  const equal = (a, b, msg) => { assert.strictEqual(a, b, msg); n += 1; };

  const catalogIds = Object.keys(CONNECTORS);
  equal(catalogIds.length, 18, 'catalog has 18 connectors');
  equal(Object.keys(CATEGORIES).length, 6, 'catalog has 6 categories');
  for (const [cat, count] of Object.entries(CATEGORY_COUNTS)) {
    equal(byCategory(cat).length, count, `${cat} has ${count} connectors`);
    for (const op of CATEGORIES[cat].capabilities.filter(o => o !== 'fetchKnowledge')) {
      const covered = byCategory(cat).every(c => c[op]);
      check(covered, `every ${cat} connector implements ${op}`);
    }
  }
  for (const id of catalogIds) {
    check(CONNECTORS[id].label, `connector ${id} has label`);
    check(CATEGORIES[CONNECTORS[id].category], `connector ${id} maps to a category`);
    check(['apikey', 'oauth', 'none'].includes(CONNECTORS[id].auth), `connector ${id} has valid auth`);
  }
  check(isConfigured('website'), 'website needs no key → configured');
  check(isConfigured('github'), 'github needs no key → configured');
  check(adapterUtil.canDo('github', 'crawl'), 'github canDo crawl');
  const ghReq = adapterUtil.buildRequest('github', 'crawl', { owner: 'Elmahrosa', repo: 'teos-dealmaker' });
  check(ghReq.url.startsWith('https://api.github.com/repos/Elmahrosa/teos-dealmaker'), 'github crawl path resolves to real repo');
  check(!isConfigured('hubspot'), 'hubspot unconfigured without env key');
  check(adapterUtil.canDo('hubspot', 'searchContacts'), 'canDo true for supported op');
  check(!adapterUtil.canDo('hubspot', 'createMeeting'), 'canDo false for unsupported op');
  check(adapterUtil.pickConnector([], null, 'crm') === null, 'no configured CRM → no pick');
  check(adapterUtil.pickConnector(['hubspot'], null, 'crm') === 'hubspot', 'enabled CRM picked');

  process.env.HUBSPOT_API_KEY = 'test_key_123';
  process.env.PIPEDRIVE_API_KEY = 'test_key_123';
  process.env.TELEGRAM_BOT_TOKEN = 'test_key_123';
  const hubReq = adapterUtil.buildRequest('hubspot', 'searchContacts', { query: 'acme' });
  equal(hubReq.method, 'POST', 'hubspot searchContacts method');
  check(hubReq.url === 'https://api.hubapi.com/crm/v3/objects/contacts/search', 'hubspot searchContacts path');
  check(hubReq.headers.Authorization === 'Bearer test_key_123', 'hubspot Bearer from env');
  check(hubReq.body.filterGroups.length === 1, 'hubspot request body filters');
  const pdReq = adapterUtil.buildRequest('pipedrive', 'searchDeals', { query: 'acme' });
  check(pdReq.url.includes('item_type=deal'), 'pipedrive query keeps item_type');
  check(pdReq.url.includes('api_token=test_key_123'), 'pipedrive query keeps api_token');
  const tgReq = adapterUtil.buildRequest('telegram', 'sendMessage', { to: '123', body: 'hi' });
  check(tgReq.url.startsWith('https://api.telegram.org/bottest_key_123/sendMessage'), 'telegram URL overrides with bot token');
  delete process.env.HUBSPOT_API_KEY;
  delete process.env.PIPEDRIVE_API_KEY;
  delete process.env.TELEGRAM_BOT_TOKEN;

  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  const tg = 9001;
  await identity.ensureUser(adapter, tg, { display_name: 'Integrations Owner' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tg)).id,
    companyName: 'Integrations Co',
    lang: 'en',
    plan: 'growth'
  });

  const integ = integrations.createIntegrations(adapter, ws.id);

  let st = await integrations.manager.status(adapter, ws.id);
  equal(st.enabled_total, 0, 'no connectors enabled initially');
  equal(st.categories.length, 6, 'hub lists all categories');

  const noConn = await integ.client.searchContacts('acme');
  check(noConn.items.length === 0, 'no connector → empty result');
  check(/No CRM connector enabled/.test(noConn.message), 'no connector → guidance message');

  await integrations.manager.enable(adapter, ws.id, 'hubspot');
  await integrations.manager.enable(adapter, ws.id, 'website');
  await integrations.manager.enable(adapter, ws.id, 'slack');
  st = await integrations.manager.status(adapter, ws.id);
  equal(st.enabled_total, 3, 'three connectors enabled');
  const hubRow = await repos.integrations.get(ws.id, 'hubspot');
  equal(hubRow.status, 'enabled', 'hubspot row enabled');
  check(hubRow.last_synced_at, 'enable stamps last_synced_at');
  const enableAudit = (await repos.audit.list(ws.id)).find(e => e.action_type === 'INTEGRATION_ENABLED');
  check(Boolean(enableAudit), 'enable writes audit entry');
  await integrations.manager.enable(adapter, ws.id, 'hubspot');
  const rowsAfterReenable = await repos.integrations.list(ws.id);
  equal(rowsAfterReenable.filter(r => r.connector_id === 'hubspot').length, 1, 'enable is idempotent (upsert)');
  const t = await integrations.manager.test(adapter, ws.id, 'hubspot');
  check(t.ok && !t.live, 'test returns dry-run without key');

  const contacts = await integ.client.searchContacts('fintech');
  equal(contacts.items.length, 3, 'searchContacts returns simulated items');
  equal(contacts.source, 'HubSpot', 'searchContacts routed to HubSpot');
  check(contacts.simulated, 'simulated fallback flagged');
  const deals = await integ.client.searchDeals('acme');
  equal(deals.items.length, 3, 'searchDeals returns simulated items');
  check(deals.items.every(d => d.value > 0), 'simulated deals carry value');

  const ping = await integ.client.sendMessage('C0123', 'hello from TEOS', 'slack');
  equal(ping.status, 'sent', 'sendMessage routed to Slack');
  equal(ping.source, 'Slack', 'sendMessage source label');

  const noCal = await integ.client.createMeeting('Kickoff', new Date().toISOString(), null);
  check(noCal.items.length === 0, 'no calendar connector → empty');
  await integrations.manager.enable(adapter, ws.id, 'google_calendar');
  const meeting = await integ.client.createMeeting('Discovery', new Date(Date.now() + 86400000).toISOString(), null);
  equal(meeting.source, 'Google Calendar', 'createMeeting routed to Google Calendar');
  check(meeting.meetingId, 'meeting id returned');

  await integrations.manager.enable(adapter, ws.id, 'google_drive');
  const file = await integ.client.storeDocument('proposal.pdf', 'content', 'google_drive');
  check(file.fileId, 'storeDocument returns file id');

  const crawl = await integ.client.crawl('teos.ai', 'website');
  equal(crawl.source, 'Website Crawl', 'crawl routed to website connector');
  check(crawl.pages >= 4, 'crawl returns page count');
  check(crawl.faqs.length >= 1, 'crawl extracts FAQs');

  await intelligence.addDocument(adapter, ws.id, {
    title: 'Enterprise Pricing',
    source_type: 'pricing',
    content: 'Enterprise plan: $2,999/year for up to 100 seats, includes onboarding and a dedicated CSM.'
  });
  const kNow = await integ.client.fetchKnowledge('enterprise pricing seats');
  check(kNow.length >= 1, 'fetchKnowledge returns knowledge hits');
  equal(kNow[0].source_type, 'pricing', 'fetchKnowledge reads the intelligence layer');

  const syncResult = await integ.sync();
  equal(syncResult.connectors.length, 5, 'sync covers all enabled connectors');
  check(syncResult.docs_written >= 4, 'sync writes CRM + website + FAQ + product docs');
  check(syncResult.deals_upserted >= 3, 'sync upserts simulated deals');
  const intelDoc = await intelligence.describe(adapter, ws.id);
  const crmSrc = intelDoc.sources.find(s => s.source_type === 'crm_data');
  check(crmSrc && crmSrc.count >= 1, 'CRM data synced into intelligence');
  const syncedDeals = await repos.deals.list(ws.id, {});
  check(syncedDeals.length >= 3, 'deals persisted from sync');
  const hubRow2 = await repos.integrations.get(ws.id, 'hubspot');
  check(hubRow2.last_synced_at, 'sync refreshes last_synced_at');
  const syncAudit = (await repos.audit.list(ws.id)).filter(e => e.action_type === 'INTEGRATION_SYNC');
  check(syncAudit.length >= 1, 'sync writes INTEGRATION_SYNC audit');

  const disabled = await integrations.manager.disable(adapter, ws.id, 'google_calendar');
  equal(disabled.status, 'disabled', 'disable flips status');
  const blockedCal = await integ.client.createMeeting('Kickoff', new Date().toISOString(), null, 'google_calendar');
  check(blockedCal.items.length === 0, 'disabled connector not routed');
  const disabledAudit = (await repos.audit.list(ws.id)).find(e => e.action_type === 'INTEGRATION_DISABLED');
  check(Boolean(disabledAudit), 'disable writes audit entry');

  const auth = oauth.beginAuth('salesforce', tg);
  check(auth.oauth && auth.url.includes('login.salesforce.com'), 'oauth URL generated for salesforce');
  check(auth.state.length > 10, 'oauth state generated');
  const noAuth = oauth.beginAuth('website', tg);
  check(!noAuth.oauth && noAuth.url === null, 'website has no oauth');
  const ex = oauth.exchange('salesforce', 'auth_code_xyz');
  check(ex.ok && ex.access_token, 'oauth exchange returns token (simulated)');
  await oauth.storeToken(adapter, ws.id, 'salesforce', 'tok_abc');
  equal(await oauth.tokenFor(adapter, ws.id, 'salesforce'), 'tok_abc', 'token round-trips through config');
  check(!(await oauth.tokenFor(adapter, ws.id, 'slack')), 'no token for other connector');

  const v = webhooks.verify('hubspot', { event: 'deal.change' }, null);
  check(v.ok && v.simulated, 'webhook verify ok without secret');
  const ing = await webhooks.ingest(adapter, ws.id, 'hubspot', 'deal.change', { subject: 'Acme deal updated', text: 'Stage moved to negotiation' });
  check(ing.ok && ing.source_type === 'conversations', 'webhook ingested as conversations doc');
  const hookAudit = (await repos.audit.list(ws.id)).find(e => e.action_type === 'INTEGRATION_WEBHOOK');
  check(Boolean(hookAudit), 'webhook writes audit entry');
  const convDoc = (await repos.intelligence.list(ws.id, 'conversations')).find(d => d.metadata && d.metadata.webhook === 'hubspot');
  check(Boolean(convDoc), 'webhook doc stored in intelligence');
  const notEnabled = await webhooks.ingest(adapter, ws.id, 'gmail', 'message.new', { text: 'x' });
  check(!notEnabled.ok && notEnabled.reason === 'connector_not_enabled', 'webhook rejected for disabled connector');

  cache.set(ws.id, 'hubspot', 'k', { v: 1 });
  equal(cache.get(ws.id, 'hubspot', 'k').v, 1, 'cache get after set');
  cache.set(ws.id, 'hubspot', 'short', { v: 2 }, 1);
  await new Promise(r => setTimeout(r, 5));
  equal(cache.get(ws.id, 'hubspot', 'short'), null, 'cache entry expires');
  check(cache.clear(ws.id) >= 1, 'cache cleared per workspace');
  equal(cache.size(), 0, 'cache empty after clear');

  const workforce = require('../services/workforce');
  const run = await workforce.runAgent(adapter, ws.id, 'prospecting', null, {
    prompt: 'Find fintech companies with 300 employees that fit our platform, using the connected CRM',
    deal_id: null
  });
  equal(run.status, 'completed', 'prompt-path agent run completes with integration context');

  const tgB = 9002;
  await identity.ensureUser(adapter, tgB);
  const wsB = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tgB)).id,
    companyName: 'Isolated Integrations',
    lang: 'en',
    plan: 'solo'
  });
  const integB = integrations.createIntegrations(adapter, wsB.id);
  const stB = await integrations.manager.status(adapter, wsB.id);
  equal(stB.enabled_total, 0, 'workspace B has no enabled connectors');
  const syncB = await integB.sync();
  equal(syncB.connectors.length, 0, 'workspace B sync touches nothing');
  equal(syncB.docs_written, 0, 'workspace B writes no docs');

  console.log(`\n✓ enterprise integration hub (${n} assertions passed)`);
  console.log(`  ${catalogIds.length} connectors · ${Object.keys(CATEGORIES).length} categories · 7 uniform ops · auto-sync → intelligence`);
  process.exit(0);
})().catch(err => {
  console.error('✗ integration test failed:', err);
  process.exit(1);
});
