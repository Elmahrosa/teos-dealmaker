const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');
const memory = require('../services/memory');
const intelligence = require('../services/intelligence');

(async () => {
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  const tg = 8001;
  await identity.ensureUser(adapter, tg, { display_name: 'Intel Owner' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tg)).id,
    companyName: 'Nile Analytics',
    lang: 'en',
    plan: 'growth'
  });

  const seeded = await intelligence.seedSources(adapter, ws.id);
  assert.strictEqual(seeded.length, 0, 'no memory yet → nothing to seed');

  await memory.setMemory(adapter, ws.id, 'company_name', 'Nile Analytics');
  await memory.setMemory(adapter, ws.id, 'industry', 'SaaS analytics');
  await memory.setMemory(adapter, ws.id, 'products', ['Insights Platform', 'Forecast API']);
  await memory.setMemory(adapter, ws.id, 'services', ['Implementation']);
  await memory.setMemory(adapter, ws.id, 'icp', { industries: ['Fintech', 'Logistics'], companySize: '50-500', geos: ['US', 'EU'] });
  await memory.setMemory(adapter, ws.id, 'competitors', ['Tegra Analytics', 'Pulse BI']);
  await memory.setMemory(adapter, ws.id, 'sales_playbook', 'Value-led: always anchor on ROI before pricing.');

  const seeded2 = await intelligence.seedSources(adapter, ws.id);
  assert.ok(seeded2.includes('company_profile'), 'company profile seeded');
  assert.ok(seeded2.includes('products'), 'products seeded');
  assert.ok(seeded2.includes('personas'), 'personas seeded from ICP');
  assert.ok(seeded2.includes('competitors'), 'competitors seeded');
  assert.ok(seeded2.includes('playbooks'), 'playbook seeded');
  assert.ok(seeded2.includes('languages') === false, 'languages empty → skipped');

  const seededAgain = await intelligence.seedSources(adapter, ws.id);
  const docsAfter = await intelligence.listDocuments(adapter, ws.id);
  assert.strictEqual(docsAfter.length, 5, 'seed is idempotent (no duplicates)');
  assert.strictEqual(seededAgain.length, 5, 're-seed re-syncs same sources');

  await intelligence.addDocument(adapter, ws.id, {
    title: 'Enterprise Pricing',
    source_type: 'pricing',
    content: 'Team plan: $999/year for up to 20 seats.\nEnterprise plan: $2,999/year for up to 100 seats, includes onboarding, priority support and a dedicated CSM.\nCustom pricing available above 100 seats.'
  });
  await intelligence.addDocument(adapter, ws.id, {
    title: 'Acme Objections Log',
    source_type: 'conversations',
    content: 'Acme raised budget concerns on the Enterprise plan. CFO asked whether discounts are possible for a 3-year commitment.'
  });
  await intelligence.addDocument(adapter, ws.id, {
    title: 'Email Templates',
    source_type: 'email_templates',
    content: 'Intro template: value-led first touch referencing the prospect industry and typical ROI.'
  });

  const docs = await intelligence.listDocuments(adapter, ws.id);
  assert.strictEqual(docs.length, 8, '5 seeded + 3 uploaded');
  const pricingDoc = docs.find(d => d.source_type === 'pricing');
  assert.strictEqual(pricingDoc.label, 'Pricing', 'source label');
  assert.ok(pricingDoc.chunks >= 1, 'content chunked');
  await intelligence.addDocument(adapter, ws.id, {
    title: 'Long Playbook',
    source_type: 'playbooks',
    content: Array.from({ length: 20 }, (_, i) => `Section ${i + 1}: step-by-step guidance for handling ${i % 2 ? 'budget' : 'timeline'} objections across the full sales cycle with measured outcomes.`).join('\n\n')
  });
  const longDoc = (await intelligence.listDocuments(adapter, ws.id)).find(d => d.title === 'Long Playbook');
  assert.ok(longDoc.chunks >= 2, 'long content splits into multiple chunks');

  const describe = await intelligence.describe(adapter, ws.id);
  assert.strictEqual(describe.total_docs, 9, 'describe counts docs');
  assert.ok(describe.total_chunks >= 9, 'describe counts chunks');
  const pricingSource = describe.sources.find(s => s.source_type === 'pricing');
  assert.strictEqual(pricingSource.count, 1, 'pricing source counted');

  const pricingAsk = await intelligence.ask(adapter, ws.id, 'Which plan fits a company with 300 employees?');
  assert.strictEqual(pricingAsk.intent.type, 'pricing', 'pricing intent detected');
  assert.ok(pricingAsk.answer.includes('Enterprise') || pricingAsk.answer.includes('enterprise'), 'answer cites enterprise pricing');
  assert.ok(pricingAsk.evidence.some(e => e.source_type === 'pricing'), 'pricing evidence retrieved');
  assert.ok(pricingAsk.simulated, 'offline evidence synthesis without keys');
  assert.strictEqual(pricingAsk.docs_count, 9, 'docs counted');

  const proposalAsk = await intelligence.ask(adapter, ws.id, 'Generate a proposal using our Enterprise pricing.');
  assert.strictEqual(proposalAsk.intent.type, 'proposal', 'proposal intent detected');
  assert.ok(proposalAsk.evidence.some(e => e.source_type === 'pricing'), 'proposal pulls pricing evidence');

  const objectionAsk = await intelligence.ask(adapter, ws.id, 'What objections has Acme raised before?');
  assert.strictEqual(objectionAsk.intent.type, 'objections', 'objection intent detected');
  assert.ok(objectionAsk.answer.includes('budget'), 'answer surfaces Acme budget concern');
  assert.ok(objectionAsk.evidence.some(e => e.source_type === 'conversations'), 'conversation evidence retrieved');

  const retrieval = await intelligence.retrieve(adapter, ws.id, 'enterprise pricing seats', { topK: 3 });
  assert.ok(retrieval.length >= 1, 'retrieval returns hits');
  assert.strictEqual(retrieval[0].source_type, 'pricing', 'top hit is the pricing doc');
  assert.ok(retrieval[0].score > retrieval[1].score, 'hits ranked by score');

  const ctx = await intelligence.getAgentContext(adapter, ws.id, 'negotiator', 'what pricing can we offer on a 3-year deal');
  assert.ok(ctx.memory.products, 'agent memory context present');
  assert.ok(ctx.knowledge.length >= 1, 'agent knowledge retrieved');
  assert.ok(['pricing', 'conversations'].includes(ctx.knowledge[0].source_type), 'negotiator sees pricing/discount knowledge');

  const emptyAsk = await intelligence.ask(adapter, ws.id, 'What is our holiday schedule?');
  assert.strictEqual(emptyAsk.answer, null, 'unknown question returns no answer');
  assert.strictEqual(emptyAsk.evidence.length, 0, 'no evidence for unknown question');
  assert.strictEqual(emptyAsk.intent.type, 'faq', 'fallback intent for how/what');

  const pricingId = docs.find(d => d.source_type === 'pricing').id;
  await intelligence.removeDocument(adapter, ws.id, pricingId);
  const afterRemove = await intelligence.ask(adapter, ws.id, 'Which plan fits a company with 300 employees?');
  assert.ok(!afterRemove.evidence.some(e => e.source_type === 'pricing'), 'pricing doc removed from retrieval');

  const tgB = 8002;
  await identity.ensureUser(adapter, tgB);
  const wsB = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tgB)).id,
    companyName: 'Isolated Co',
    lang: 'en',
    plan: 'solo'
  });
  const docsB = await intelligence.listDocuments(adapter, wsB.id);
  assert.strictEqual(docsB.length, 0, 'intelligence isolated per workspace');
  const askB = await intelligence.ask(adapter, wsB.id, 'Which plan fits a 300-person company?');
  assert.strictEqual(askB.docs_count, 0, 'workspace B has no knowledge');

  const workforce = require('../services/workforce');
  const enrichedRun = await workforce.runAgent(adapter, ws.id, 'prospecting', null, {
    prompt: 'Find fintech companies with 300 employees that would fit our platform',
    deal_id: null
  });
  assert.strictEqual(enrichedRun.status, 'completed', 'prompt-path agent run completes');
  assert.ok(enrichedRun.result.output.length > 0, 'prompt-path run produces output');
  const enrichedRuns = await repos.agentRuns.list(ws.id);
  const lastRun = enrichedRuns[0];
  assert.ok(lastRun.provider, 'run records provider from generation');

  console.log(`\n✓ enterprise intelligence layer (${39} assertions passed)`);
  console.log(`  ${describe.total_docs} docs · ${describe.total_chunks} chunks · ${describe.sources.length} source types · copilot intent ${pricingAsk.intent.type}`);
  process.exit(0);
})().catch(err => {
  console.error('✗ intelligence test failed:', err);
  process.exit(1);
});
