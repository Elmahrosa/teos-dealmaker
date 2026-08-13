// tests/revenue-ops-discovery.test.js
// Discovery + deterministic scoring engine, exercised against the in-memory
// adapter (no DATABASE_URL required). Run via `npm test` or directly.
'use strict';

const assert = require('assert');
const dbMod = require('../db');

process.env.SOR_ENABLED = 'true';

async function main() {
  console.log('🧪 Revenue Operations Discovery Test\n');

  const { scoreCandidate, matchCategory, stageFor, hasWebsite, isGenericCompany } = require('../services/revenueOps/discovery');

  // ---- pure scoring ----
  const rich = scoreCandidate({
    company_name: 'Nile Fabric',
    website: 'https://nilefabric.com',
    contact_email: 'ops@nilefabric.com',
    category: 'revenue-operations',
    status: 'REPLIED'
  });
  assert.strictEqual(rich.score, 20 + 20 + 15 + 15 + 10 + 20, 'rich candidate must score 100');
  assert.strictEqual(rich.sentinel_verdict, 'approve', 'score >= 70 must approve');
  assert.strictEqual(rich.confidence, 100, 'full verifiability must reach 100 confidence');

  const generic = scoreCandidate({ company_name: 'Company', status: 'SENT' });
  assert.strictEqual(generic.score, 20 - 15 + 8, 'generic name must deduct 15 and SENT adds 8');
  assert.strictEqual(generic.sentinel_verdict, 'hold', 'score < 45 must hold');
  assert.strictEqual(generic.confidence, 60, 'no verifiable signals keeps base confidence');

  const review = scoreCandidate({ company_name: 'Aswan Tech', category: 'developer-platform' });
  assert.strictEqual(review.sentinel_verdict, 'review', 'mid scores must review');
  assert.strictEqual(review.score, 20 + 15 + 10, 'named + category fit = 45');

  assert.strictEqual(scoreCandidate({}).score, 5, 'empty candidate floors at generic penalty');

  assert.strictEqual(hasWebsite('https://nilefabric.com'), true, 'real website detected');
  assert.strictEqual(hasWebsite(''), false, 'no website');
  assert.strictEqual(isGenericCompany('Acme'), true, 'generic name flagged');
  assert.strictEqual(matchCategory('Sales Pipeline'), 'revenue-operations', 'category taxonomy match');
  assert.strictEqual(stageFor(85), 'engaged', '>=70 stages engaged');
  assert.strictEqual(stageFor(50), 'qualified', '>=45 stages qualified');
  assert.strictEqual(stageFor(30), 'discovered', '<45 stages discovered');

  // ---- discover() against in-memory adapter ----
  const adapter = dbMod.createMemoryAdapter();
  const db = { adapter, pg: null, repos: dbMod.createRepos(adapter) };
  await db.adapter.insert('workspaces', { name: 'Founder Workspace', slug: 'workspace_founder' });
  const revenueOps = require('../services/revenueOps');

  await revenueOps.recordProspect(adapter, { contact_email: 'ops@nilefabric.com', company_name: 'Nile Fabric', website: 'https://nilefabric.com', category: 'revenue-operations', status: 'REPLIED', source: 'MANUAL' });
  await revenueOps.recordProspect(adapter, { contact_email: 'ops@generic.co', company_name: 'Company', status: 'SENT', source: 'MANUAL' });

  const d1 = await revenueOps.discover(adapter, { limit: 10 });
  assert.strictEqual(d1.ok, true, 'discover must succeed');
  assert.strictEqual(d1.scored, 2, 'both prospects must be scored');

  const nile = await db.adapter.findOne('prospects', { contact_email: 'ops@nilefabric.com' });
  assert.strictEqual(nile.score_source, 'revenue-ops-discovery', 'score source persisted');
  assert.strictEqual(nile.score, 100, 'scored value persisted');
  assert.strictEqual(nile.sentinel_verdict, 'approve', 'verdict persisted');
  assert.ok(nile.score_reason && nile.score_reason.length > 0, 'reason persisted');

  const d2 = await revenueOps.discover(adapter, { limit: 10, onlyUnscored: true });
  assert.strictEqual(d2.scored, 0, 'onlyUnscored must skip already-scored prospects');

  const audits = await db.adapter.find('audit_trail', { action_type: 'PROSPECT_SCORED' });
  assert.strictEqual(audits.length, 2, 'each scoring must emit a PROSPECT_SCORED audit entry');
  for (const a of audits) {
    assert.ok(a.timestamp, 'audit entries must carry a timestamp');
    assert.strictEqual(a.details.verdict, a.details.score >= 70 ? 'approve' : 'hold', 'audit verdict must match score');
  }

  console.log(`  ✓ scoreCandidate: approve=${rich.sentinel_verdict} hold=${generic.sentinel_verdict} review=${review.sentinel_verdict}`);
  console.log(`  ✓ discover: scored=${d1.scored} onlyUnscored=${d2.scored} audits=${audits.length}`);
  console.log('\nRevenue Operations Discovery Test PASSED ✅\n');
  return 0;
}

main().then(code => process.exit(code)).catch(err => { console.error('\nDiscovery Test FAILED:', err.message); process.exit(1); });
