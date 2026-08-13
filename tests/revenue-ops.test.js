// tests/revenue-ops.test.js
// Revenue Operations persistence + scheduler, exercised against the in-memory
// adapter (no DATABASE_URL required). Run via `npm test` or directly.
'use strict';

const assert = require('assert');
const dbMod = require('../db');

process.env.SOR_ENABLED = 'true';

async function main() {
  console.log('🧪 Revenue Operations Test\n');

  // ---- gate ----
  assert.strictEqual(dbMod.isSorEnabled(), true, 'SOR_ENABLED=true must enable SOR');
  assert.strictEqual(dbMod.isSorEnabled(), dbMod.isSorEnabled(), 'gate must be stable across calls');

  // ---- fresh in-memory state ----
  const adapter = dbMod.createMemoryAdapter();
  const db = { adapter, pg: null, repos: dbMod.createRepos(adapter) };
  await db.adapter.insert('workspaces', { name: 'Founder Workspace', slug: 'workspace_founder' });
  const r = db.repos;

  // ---- target-customer persistence ----
  const revenueOps = require('../services/revenueOps');
  const first = await revenueOps.recordProspect(adapter, {
    contact_email: 'ops@nilefabric.com',
    company_name: 'Nile Fabric',
    source: 'MANUAL',
    score: 60,
    score_reason: 'founder-introduced',
    score_source: 'founder'
  });
  assert.strictEqual(first.ok, true, 'first prospect record must succeed');
  assert.strictEqual(first.created, true, 'first record is a create');

  const dup = await revenueOps.recordProspect(adapter, {
    contact_email: 'ops@nilefabric.com',
    source: 'MANUAL',
    score: 70,
    score_reason: 're-scored',
    score_source: 'founder'
  });
  assert.strictEqual(dup.ok, true, 'duplicate prospect record must succeed');
  assert.strictEqual(dup.created, false, 'duplicate record must update, not create');
  const stored = await db.adapter.findOne('prospects', { contact_email: 'ops@nilefabric.com' });
  assert.strictEqual(stored.score, 70, 'score must keep the max');

  // ---- outbound -> prospect sync ----
  await r.outboundEmails.create({ workspace_id: 1, to_email: 'cfo@mega.co', from_email: 'founder@elmahrosa.org', subject: 'intro', status: 'SENT' });
  await r.outboundEmails.create({ workspace_id: 1, to_email: 'ceo@mega.co', from_email: 'founder@elmahrosa.org', subject: 'reply', status: 'REPLIED' });
  const synced = await revenueOps.syncProspects(adapter, 50);
  assert.strictEqual(synced.created, 2, 'sync must create prospects for sent emails');
  const engaged = await db.adapter.findOne('prospects', { contact_email: 'ceo@mega.co' });
  assert.strictEqual(engaged.status, 'ENGAGED', 'REPLIED engagement must be ENGAGED');

  const nowMs = Date.now();
  const winMetrics = await revenueOps._report.collectMetrics(db, nowMs - 1000, nowMs + 1000);
  assert.strictEqual(winMetrics.sent, 2, 'metrics must count delivered emails in the window');
  assert.strictEqual(winMetrics.failed, 0, 'metrics must count failures separately');

  // ---- manual founder trigger: persists report, sends fail-closed, idempotent ----
  const result = await revenueOps.triggerNow(adapter, 'test-founder');
  assert.strictEqual(result.ok, true, 'trigger must succeed');
  assert.ok(Array.isArray(result.processed) && result.processed.length === 1, 'exactly one window processed');
  const w = result.processed[0];
  assert.strictEqual(w.delivery.ok, false, 'no RESEND_API_KEY => fail closed');
  assert.strictEqual(w.delivery.reason, 'resend_not_configured', 'must fail with resend_not_configured');

  const rows = await r.founderReports.list({});
  assert.strictEqual(rows.length, 1, 'one founder report persisted');
  assert.strictEqual(rows[0].delivery_status, 'failed', 'report delivery marked failed');
  assert.strictEqual(rows[0].failure_reason, 'resend_not_configured', 'failure reason recorded');
  assert.ok(rows[0].metrics && typeof rows[0].metrics.sent === 'number', 'metrics captured in report row');

  const second = await revenueOps.triggerNow(adapter, 'test-founder');
  assert.strictEqual(second.ok, true, 'second trigger must succeed');
  assert.strictEqual(second.upToDate, true, 'second trigger must be idempotent/up to date');
  assert.strictEqual((await r.founderReports.list({})).length, 1, 'no duplicate reports');

  // ---- audit trail emitted ----
  const audits = await r.audit.list(null, {});
  const types = audits.map(a => a.action_type);
  assert.ok(types.includes('FOUNDER_REPORT_GENERATED'), 'generation audit entry present');
  assert.ok(types.includes('FOUNDER_REPORT_DELIVERY'), 'delivery audit entry present');

  // ---- status ----
  const st = await revenueOps.status(adapter);
  assert.strictEqual(st.ok, true, 'status must return ok');
  assert.strictEqual(st.enabled, true, 'status enabled');
  assert.strictEqual(st.lastWindowEnd, w.windowEnd, 'status reports last window end');
  assert.strictEqual(st.prospectsTotal, 3, 'three prospects persisted total');
  assert.strictEqual(st.reportsTotal, 1, 'one report persisted total');

  // ---- founder control: pause stops automatic tick ----
  const paused = await revenueOps.setMode(adapter, 'PAUSED', 'test-founder', 'test');
  assert.strictEqual(paused.ok, true, 'pause must succeed');
  const dbR = { adapter, pg: null, repos: r };
  const autoTick = await revenueOps._scheduler.tick(dbR, {});
  assert.strictEqual(autoTick.ok, false, 'automatic tick gated while paused');
  assert.strictEqual(autoTick.reason, 'paused', 'paused tick must refuse via the live guard');

  const resumed = await revenueOps.setMode(adapter, 'RUNNING', 'test-founder', null);
  assert.strictEqual(resumed.ok, true, 'resume must succeed');
  const autoTick2 = await revenueOps._scheduler.tick(dbR, {});
  assert.strictEqual(autoTick2.ok, true, 'automatic tick allowed when RUNNING');
  assert.strictEqual(autoTick2.upToDate, true, 'running tick still idempotent');

  // ---- backfill cap: no unbounded replay after a long pause ----
  process.env.SOR_MAX_BACKFILL_WINDOWS = '3';
  const cfg = revenueOps._core.config();
  const capNow = Date.now();
  const currentEnd = revenueOps._report.windowEndOf(capNow, cfg.intervalMs);
  await r.revenueOps.set(revenueOps._core.KEY_LAST_WINDOW, new Date(currentEnd - 10 * cfg.intervalMs).toISOString());
  const bf = await revenueOps._scheduler.tick(dbR, {});
  assert.strictEqual(bf.ok, true, 'backfill tick must succeed');
  assert.strictEqual(bf.backfilled, 3, 'only cap windows backfilled');
  assert.strictEqual(bf.processed.length, 3, 'exactly cap reports generated');
  assert.ok(bf.skippedMissedWindows >= 7, 'older missed windows must be skipped, not replayed');
  assert.strictEqual(bf.processed[bf.processed.length - 1].windowEnd, bf.currentWindowEnd, 'most recent window backfilled last');
  const skippedAudits = (await r.audit.list(null, {})).filter(a => a.action_type === 'REVENUE_OPS_WINDOWS_SKIPPED');
  assert.strictEqual(skippedAudits.length, 1, 'skip-gap audit emitted');
  assert.ok(skippedAudits[0].details.skipped >= 7, 'skip audit records gap size');
  assert.ok(skippedAudits[0].details.from && skippedAudits[0].details.to, 'skip audit records gap range');

  // skipped gap must surface in the next founder report output, then be consumed
  const allReports = await r.founderReports.list({});
  const surfacing = allReports.find(x => x.metrics && x.metrics.skippedWindows && x.metrics.skippedWindows.skipped >= 7);
  assert.ok(surfacing, 'a report after the gap must surface skipped-window info in its metrics');
  assert.ok(revenueOps._report.renderText(surfacing.metrics).includes('Windows skipped'), 'report text includes skipped-window line');
  const consumed = await db.adapter.findOne('revenue_ops_state', { key: 'sor_last_window_skip' });
  assert.ok(!consumed || !consumed.payload, 'skip marker consumed once surfaced in a report');
  delete process.env.SOR_MAX_BACKFILL_WINDOWS;

  console.log('✅ Revenue Operations: gate, persistence, sync, scheduler, audit — all passing');
}

main().catch(err => {
  console.error('❌ Revenue Operations test failed:', err && err.message ? err.message : err);
  process.exit(1);
});
