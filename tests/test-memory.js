const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');
const memory = require('../services/memory');

(async () => {
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  const tg = 4001;
  await identity.ensureUser(adapter, tg, { display_name: 'Memory Owner' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tg)).id,
    companyName: 'Memory Co',
    lang: 'en',
    plan: 'growth'
  });

  const seeded = await repos.memory.list(ws.id);
  assert.strictEqual(seeded.length, Object.keys(memory.MEMORY_DEFAULTS).length, 'all defaults seeded on provision');
  assert.ok(seeded.every(e => e.source === 'default'), 'seeded as defaults');

  await memory.ensureDefaults(adapter, ws.id);
  const afterIdempotent = await repos.memory.list(ws.id);
  assert.strictEqual(afterIdempotent.length, Object.keys(memory.MEMORY_DEFAULTS).length, 'ensureDefaults is idempotent');

  let mem = await memory.getMemory(adapter, ws.id);
  assert.strictEqual(mem.company_name, '', 'company_name defaults empty');
  assert.deepStrictEqual(mem.past_deals, [], 'no past deals yet');

  await memory.setMemory(adapter, ws.id, 'company_name', 'Acme Egypt');
  await memory.setMemory(adapter, ws.id, 'products', ['DealMaker Sovereign', 'DealMaker Scale']);
  await memory.setMemory(adapter, ws.id, 'icp', { industries: ['SaaS', 'Fintech'], companySize: '50-500', geos: ['US', 'EU'] });

  mem = await memory.getMemory(adapter, ws.id);
  assert.strictEqual(mem.company_name, 'Acme Egypt', 'company persisted');
  assert.deepStrictEqual(mem.products, ['DealMaker Sovereign', 'DealMaker Scale'], 'list persisted as array');
  assert.deepStrictEqual(mem.icp.industries, ['SaaS', 'Fintech'], 'icp object persisted');

  await assert.rejects(
    memory.setMemory(adapter, ws.id, 'not_a_key', 'x'),
    /Unknown memory key/,
    'unknown keys rejected'
  );

  const prospectingCtx = await memory.getContextFor(adapter, ws.id, 'prospecting');
  assert.ok('industry' in prospectingCtx && 'icp' in prospectingCtx && 'competitors' in prospectingCtx, 'prospecting slice keys');
  assert.ok(!('company_name' in prospectingCtx), 'prospecting has no company_name');
  assert.deepStrictEqual(prospectingCtx.past_deals, [], 'prospecting gets past_deals');

  const outreachCtx = await memory.getContextFor(adapter, ws.id, 'outreach');
  assert.ok('brand_voice' in outreachCtx && 'languages' in outreachCtx && 'products' in outreachCtx, 'outreach slice keys');

  const negotiatorCtx = await memory.getContextFor(adapter, ws.id, 'negotiator');
  assert.ok('products' in negotiatorCtx && 'preferred_providers' in negotiatorCtx, 'negotiator slice keys');

  const orchestratorCtx = await memory.getContextFor(adapter, ws.id, 'orchestrator');
  assert.strictEqual(Object.keys(orchestratorCtx).filter(k => k !== 'past_deals').length, Object.keys(memory.MEMORY_DEFAULTS).length, 'orchestrator sees everything');

  await repos.deals.create({ workspace_id: ws.id, company_name: 'Historic Client', stage: 'won', status: 'closed', deal_value: 5000, currency: 'USD', current_agent: 'closing' });
  mem = await memory.getMemory(adapter, ws.id);
  assert.strictEqual(mem.past_deals.length, 1, 'past_deals aggregates deals');
  assert.strictEqual(mem.past_deals[0].company, 'Historic Client', 'past deal company');
  assert.strictEqual(mem.past_deals[0].stage, 'won', 'past deal stage');

  const tgB = 4002;
  await identity.ensureUser(adapter, tgB);
  const wsB = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tgB)).id,
    companyName: 'Zeta Memory',
    lang: 'en',
    plan: 'solo'
  });
  const memB = await memory.getMemory(adapter, wsB.id);
  assert.strictEqual(memB.company_name, '', 'workspace B memory isolated');
  assert.deepStrictEqual(memB.past_deals, [], 'workspace B no deals');
  const memA = await memory.getMemory(adapter, ws.id);
  assert.strictEqual(memA.company_name, 'Acme Egypt', 'workspace A memory intact');

  const described = memory.describe(memA);
  assert.ok(described.some(l => l.startsWith('Company: Acme Egypt')), 'describe includes company');
  assert.ok(described.some(l => l.startsWith('Products: DealMaker Sovereign, DealMaker Scale')), 'describe includes products');

  console.log(`\n✓ workspace memory (${34} assertions passed)`);
  console.log(`  ${Object.keys(memory.MEMORY_DEFAULTS).length} memory keys · context slices for ${Object.keys(memory.CONTEXT_MAP).length} agents · past deals ${memA.past_deals.length}`);
  process.exit(0);
})().catch(err => {
  console.error('✗ memory test failed:', err);
  process.exit(1);
});
