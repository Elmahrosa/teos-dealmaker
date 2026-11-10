'use strict';
// Customer #0 lifecycle + the won/closed gate at the repository boundary +
// founder-only sales + accurate outbound audit state.
process.env.NODE_ENV = 'test';
process.env.TEOS_FOUNDER_TELEGRAM_ID = '7700009';
const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const seedMod = require('../services/founderSeed');
const queue = require('../services/queue');
const audit = require('../utils/auditLogger');
const { createTestPaymentVerifier, evidenceFor } = require('./helpers/testPaymentVerifier');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n += 1; };
const rejects = async (p, re, m) => { await assert.rejects(p, re, m); n += 1; };
const throwsCode = (fn, code, m) => { try { fn(); } catch (e) { eq(e.code, code, m); return; } assert.fail(m); };

(async () => {
  // ---- 1. seed: incoming/open, same record preserved on re-seed -------------
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);
  const seed = await seedMod.ensureFounderWorkspace(adapter);
  const wsId = seed.workspace.id;
  const c0 = seed.customer0;
  eq(c0.company_name, 'Elmahrosa International', 'identity');
  eq(c0.stage, 'incoming', 'seed stage'); eq(c0.status, 'open', 'seed status');
  const again = await seedMod.ensureFounderWorkspace(adapter);
  eq(again.customer0.id, c0.id, 'same record id on re-seed');
  eq((await repos.deals.list(wsId, {})).filter(d => d.company_name === c0.company_name).length, 1, 'no twin');

  // A valid record the founder moved forward is NOT reset by seeding.
  await repos.deals.update(wsId, c0.id, { stage: 'proposal' });
  await seedMod.ensureFounderWorkspace(adapter);
  eq((await repos.deals.get(wsId, c0.id)).stage, 'proposal', 'valid progressed record not reset');
  await repos.deals.update(wsId, c0.id, { stage: 'incoming' });

  // ---- 2. legacy active/active migration: idempotent, id + data preserved ---
  const legacy = createMemoryAdapter();
  const lr = createRepos(legacy);
  const lseed = await seedMod.ensureFounderWorkspace(legacy);
  const lws = lseed.workspace.id;
  const row = lseed.customer0;
  await lr.deals.update(lws, row.id, { stage: 'active', status: 'active', deal_value: 4200 });
  const notesBefore = (await lr.dealNotes.list(lws, row.id)).length;
  await seedMod.ensureFounderWorkspace(legacy);
  const migrated = await lr.deals.get(lws, row.id);
  eq(migrated.id, row.id, 'migration keeps record id');
  eq(migrated.stage, 'incoming', 'legacy stage migrated'); eq(migrated.status, 'open', 'legacy status migrated');
  eq(Number(migrated.deal_value), 4200, 'migration keeps existing data');
  eq((await lr.dealNotes.list(lws, row.id)).length, notesBefore, 'notes untouched');
  await seedMod.ensureFounderWorkspace(legacy);
  await seedMod.ensureFounderWorkspace(legacy);
  eq((await lr.audit.list(lws, {})).filter(a => a.action_type === 'CUSTOMER_ZERO_MIGRATED').length, 1, 'migration runs once (idempotent)');
  eq((await lr.deals.list(lws, {})).length, 1, 'no extra deals created');
  // A non-legacy state (e.g. qualification/open) is never rewritten.
  await lr.deals.update(lws, row.id, { stage: 'qualification', status: 'open' });
  await seedMod.ensureFounderWorkspace(legacy);
  eq((await lr.deals.get(lws, row.id)).stage, 'qualification', 'non-legacy state untouched');

  // ---- 3. repository boundary: won/closed only via closeWon ----------------
  throwsCode(() => repos.deals.update(wsId, c0.id, { stage: 'won' }), 'WON_NOT_VERIFIED', 'update stage=won refused');
  throwsCode(() => repos.deals.update(wsId, c0.id, { status: 'closed' }), 'WON_NOT_VERIFIED', 'update status=closed refused');
  throwsCode(() => repos.deals.update(wsId, c0.id, { status: 'won' }), 'WON_NOT_VERIFIED', 'update status=won refused');
  throwsCode(() => repos.deals.create({ workspace_id: wsId, company_name: 'X', stage: 'won' }), 'WON_NOT_VERIFIED', 'create as won refused');
  await rejects(repos.deals.advanceStage(wsId, c0.id, 'won'), /won_or_closed/, 'advanceStage won refused');
  const c0now = await repos.deals.get(wsId, c0.id);
  eq(c0now.stage, 'incoming', 'Customer #0 unchanged after refused writes'); eq(c0now.status, 'open', 'status unchanged');

  // Production wiring (no verifier) fails closed, even for well-formed claims.
  const verifier = createTestPaymentVerifier();
  const deal = await repos.deals.create({ workspace_id: wsId, company_name: 'Acme Co', stage: 'closing', deal_value: 100, currency: 'USD' });
  const ev = evidenceFor(verifier, { amount: 100, tag: 'a' });
  await rejects(repos.deals.closeWon(wsId, deal.id, ev), /no_trusted_payment_verifier_configured/, 'no verifier => refused');
  await rejects(queue.advanceQueue(adapter, wsId, deal.id, 'won', ev), /no_trusted_payment_verifier_configured/, 'queue path refused too');

  const vr = createRepos(adapter, { paymentVerifier: verifier });
  // Fabricated claims: well-formed but never independently recorded.
  const fake = { customerAcceptance: ev.customerAcceptance, paymentEvidence: { ...ev.paymentEvidence, reference: 'bank-ref-FAKE-1' } };
  await rejects(vr.deals.closeWon(wsId, deal.id, fake), /payment_not_independently_verified/, 'fabricated provider reference refused');
  const founderAssert = { customerAcceptance: ev.customerAcceptance, paymentEvidence: { ...ev.paymentEvidence, source: 'founder_confirmed_receipt', reference: 'rcpt-9999', receiptDocument: 'receipts/x.pdf', confirmedBy: 'founder:1' } };
  await rejects(vr.deals.closeWon(wsId, deal.id, founderAssert), /payment_not_independently_verified/, 'founder assertion without recorded evidence refused');
  await rejects(vr.deals.closeWon(wsId, deal.id, { customerAcceptance: ev.customerAcceptance, paymentEvidence: { ...ev.paymentEvidence, amount: 1 } }), /won_requires/, 'amount mismatch refused');
  await rejects(vr.deals.closeWon(wsId, deal.id, { customerAcceptance: { accepted: true, acceptedBy: 'x@y.z', acceptedAt: new Date().toISOString(), proofRef: 'unrecorded-proof' }, paymentEvidence: ev.paymentEvidence }), /acceptance_not_independently_verified/, 'unrecorded acceptance refused');
  eq((await repos.deals.get(wsId, deal.id)).stage, 'closing', 'deal still open after refusals');

  // Customer #0 can never be won, even with a verifier and ledger evidence.
  await repos.deals.update(wsId, c0.id, { deal_value: 100, currency: 'USD' });
  await rejects(vr.deals.closeWon(wsId, c0.id, evidenceFor(verifier, { amount: 100, tag: 'c0' })), /protected_deal_cannot_be_won/, 'Customer #0 cannot be won');
  const c0after = await repos.deals.get(wsId, c0.id);
  eq(c0after.stage, 'incoming', 'Customer #0 still incoming'); eq(c0after.status, 'open', 'Customer #0 still open');

  // Cross-tenant closeWon returns null and changes nothing.
  eq(await vr.deals.closeWon(wsId + 999, deal.id, ev), null, 'cross-tenant closeWon returns null');

  // Positive: ledger-backed evidence wins a normal deal, audited with verified facts.
  const won = await vr.deals.closeWon(wsId, deal.id, ev);
  eq(won.stage, 'won', 'verified win stage'); eq(won.status, 'closed', 'verified win status');
  const wonAgain = await vr.deals.closeWon(wsId, deal.id, ev);
  eq(wonAgain.stage, 'won', 'repeat win is idempotent');
  eq((await repos.pipeline.list(wsId, deal.id)).filter(e => e.to_stage === 'won').length, 1, 'one won pipeline event only');
  ok(audit.readVault().some(e => e.action === 'DEAL_WON'), 'win audited');
  ok(audit.readVault().some(e => e.action === 'DEAL_WON_REJECTED'), 'rejections audited');

  // ---- 3b. raw adapter boundary: terminal writes need the repo capability
  throwsCode(() => adapter.update('deals', { workspace_id: wsId, id: c0.id }, { stage: 'won' }), 'WON_NOT_VERIFIED', 'raw adapter.update won refused');
  throwsCode(() => adapter.update('deals', { workspace_id: wsId, id: c0.id }, { status: 'closed' }), 'WON_NOT_VERIFIED', 'raw adapter.update closed refused');
  throwsCode(() => adapter.insert('deals', { workspace_id: wsId, company_name: 'Raw', stage: 'won', status: 'closed' }), 'WON_NOT_VERIFIED', 'raw adapter.insert won refused');
  eq((await repos.deals.get(wsId, c0.id)).stage, 'incoming', 'Customer #0 unchanged by raw attempts');

  // ---- 3c. concurrent wins of the same deal: exactly one transition
  const race = await repos.deals.create({ workspace_id: wsId, company_name: 'Race Co', stage: 'closing', deal_value: 50, currency: 'USD' });
  const rev = evidenceFor(verifier, { amount: 50, tag: 'race' });
  const results = await Promise.all([1, 2, 3, 4].map(() => vr.deals.closeWon(wsId, race.id, rev)));
  ok(results.every(r => r.stage === 'won'), 'all concurrent callers see won');
  eq((await repos.pipeline.list(wsId, race.id)).filter(e => e.to_stage === 'won').length, 1, 'concurrent wins record one event');

  // ---- 3c2. memory adapter honours the same all-or-nothing contract
  const dealsBefore = (await adapter.find('deals', { workspace_id: wsId })).length;
  await rejects(adapter.withTransaction(async t => {
    await t.insert('deals', { workspace_id: wsId, company_name: 'Rolled Back', stage: 'lead', status: 'open' });
    throw new Error('forced');
  }), /forced/, 'withTransaction propagates the error');
  eq((await adapter.find('deals', { workspace_id: wsId })).length, dealsBefore, 'memory withTransaction rolled back');
  const atom = await repos.deals.create({ workspace_id: wsId, company_name: 'Atomic Co', stage: 'closing', deal_value: 10, currency: 'USD' });
  const aev = evidenceFor(verifier, { amount: 10, tag: 'atomic' });
  const failingAdapter = { ...adapter, withTransaction: fn => adapter.withTransaction(t => fn({ ...t, insert: (tbl, row, cap) => { if (tbl === 'pipeline_events') throw new Error('injected'); return t.insert(tbl, row, cap); } })) };
  await rejects(createRepos(failingAdapter, { paymentVerifier: verifier }).deals.closeWon(wsId, atom.id, aev), /injected/, 'event failure surfaces');
  eq((await repos.deals.get(wsId, atom.id)).stage, 'closing', 'memory closeWon rolled back on event failure');
  eq((await vr.deals.closeWon(wsId, atom.id, aev)).stage, 'won', 'retry after failure wins');

  // ---- 3c3. memory outbox: pending on vault failure, idempotent recovery
  const outbox = require('../services/auditOutbox');
  const ob = await repos.deals.create({ workspace_id: wsId, company_name: 'Outbox Co', stage: 'closing', deal_value: 12, currency: 'USD' });
  const obev = evidenceFor(verifier, { amount: 12, tag: 'outbox' });
  const realWrite = audit.writeEntry;
  const quiet = console.error; console.error = () => {};
  audit.writeEntry = () => { throw new Error('vault_down'); };
  let obRes;
  try { obRes = await vr.deals.closeWon(wsId, ob.id, obev); } finally { audit.writeEntry = realWrite; console.error = quiet; }
  eq(obRes.stage, 'won', 'win committed despite vault failure'); eq(obRes.audit_vault, 'FAILED', 'vault failure reported');
  eq((await outbox.counts(adapter)).pending, 1, 'one pending outbox event');
  const rec = await outbox.reconcile(adapter);
  eq(rec.delivered, 1, 'reconcile delivers'); eq(rec.counts.pending, 0, 'none pending');
  const evId = (await adapter.findOne('audit_outbox', { deal_id: ob.id })).event_id;
  eq(audit.readVault().filter(e => e.details && e.details.eventId === evId).length, 1, 'one vault entry');
  await outbox.reconcile(adapter);
  eq(audit.readVault().filter(e => e.details && e.details.eventId === evId).length, 1, 'repeat reconcile adds none');
  eq(audit.verifyVault().valid, true, 'vault chain valid');

  // ---- 3c4. ops: failed-count alert is throttled; startup cycle is bounded and repeat-safe
  {
    const sent = [];
    const notifier = { notify: async (t, b) => { sent.push([t, b]); } };
    const q = console.error; console.error = () => {};
    await outbox.alertIfFailed({ failed: 0, pending: 0 }, { notifier });
    eq(sent.length, 0, 'no alert when nothing failed');
    await outbox.alertIfFailed({ failed: 1, pending: 0 }, { notifier, now: 1000 });
    eq(sent.length, 1, 'alert on first failure');
    await outbox.alertIfFailed({ failed: 1, pending: 0 }, { notifier, now: 2000 });
    await outbox.alertIfFailed({ failed: 1, pending: 2 }, { notifier, now: 3000 });
    eq(sent.length, 1, 'repeat retries do not re-notify');
    await outbox.alertIfFailed({ failed: 2, pending: 0 }, { notifier, now: 4000 });
    eq(sent.length, 2, 'a rising failed count notifies again');
    await outbox.alertIfFailed({ failed: 2, pending: 0 }, { notifier, now: 4000 + 6 * 3600 * 1000 });
    eq(sent.length, 3, 'reminder after the throttle window');
    await outbox.alertIfFailed({ failed: 0, pending: 0 }, { notifier });
    console.error = q;
    ok(!/secret|token/i.test(sent[0][1]), 'alert text carries counts only');

    // Startup reconcile: repeat-safe, never throws, never hangs (bounded).
    const r1 = await outbox.reconcileOnStartup(adapter); const r2 = await outbox.reconcileOnStartup(adapter);
    ok(!r1.error && !r2.error, 'startup reconcile ok twice'); eq(r2.processed, 0, 'second startup reconcile is a no-op');
    const hung = { find: () => new Promise(() => {}), findOne: () => new Promise(() => {}), update: () => new Promise(() => {}) };
    const t0 = Date.now(); const q2 = console.error; console.error = () => {};
    const hr = await outbox.reconcileOnStartup(hung, { timeoutMs: 150 });
    console.error = q2;
    eq(hr.error, 'reconcile_timeout', 'hung database cannot block startup indefinitely'); ok(Date.now() - t0 < 2000, 'returned within the bound');
    // Mutex contract of the memory adapter.
    const order = [];
    const l1 = adapter.withAdvisoryLock('k', async () => { order.push('a'); await new Promise(r => setTimeout(r, 60)); order.push('a2'); });
    await new Promise(r => setTimeout(r, 10));
    const busy = await adapter.withAdvisoryLock('k', async () => order.push('b'), { timeoutMs: 20 });
    eq(busy.acquired, false, 'second holder is refused after the wait'); await l1;
    eq(order.join(','), 'a,a2', 'refused caller did not run');
    eq((await adapter.withAdvisoryLock('k', async () => 1)).acquired, true, 'lock reusable after release');
  }

  // ---- 3d. verifier slot: trusted install only, one-shot, sealed after first use
  const pv = require('../services/paymentVerifier');
  eq(pv.getTrustedVerifier(), null, 'no verifier installed in this codebase');
  assert.throws(() => pv.installTrustedVerifier(verifier), /sealed/); n += 1;
  const fs = require('fs'); const path = require('path');
  const root = path.join(__dirname, '..');
  const offenders = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'tests', '.git', 'docs', 'deliverables'].includes(f.name)) continue;
      const full = path.join(d, f.name);
      if (f.isDirectory()) walk(full);
      else if (f.name.endsWith('.js') && /paymentVerifier\s*[:=]|installTrustedVerifier\(/.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(root, full));
    }
  })(root);
  assert.deepStrictEqual(offenders.sort(), ['db/repos.js', 'services/paymentVerifier.js'], 'production code never installs/injects a verifier: ' + offenders); n += 1;

  // ---- 3e. CRM connector won/closed is an unverified claim
  const { sanitizeExternalDeal } = require('../services/dealLifecycle');
  const s1 = sanitizeExternalDeal({ company: 'X', stage: 'won', status: 'closed' });
  eq(s1.stage, 'closing', 'external won kept open'); eq(s1.status, 'open', 'external closed kept open'); eq(s1.externalTerminalClaim, true, 'flagged');

  // ---- 4. sales authorization -------------------------------------------
  const { COMMANDS } = require('../bot/commands');
  const { getMode, setMode } = require('../config/mode');
  for (const c of ['/mode', '/live', '/dry', '/outreach', '/qualify', '/sales']) {
    const r = await COMMANDS[c](1, 424242, 'The price is too high');
    ok(/Access denied|Founder only/i.test(r.text), `${c} denied for non-founder`);
  }
  const before = getMode();
  eq(getMode(), before, 'non-founder commands did not change mode');
  const salesFounder = await COMMANDS['/sales'](1, 7700009, 'The price is too high');
  ok(!/Access denied/i.test(salesFounder.text), '/sales works for founder');

  // ---- 5. outbound audit accuracy ---------------------------------------
  const { route } = require('../agents/router');
  setMode('LIVE');
  const r = route({ id: 'm1', body: 'hello' }, 'customer');
  eq(r.status, 'PENDING_DELIVERY', 'LIVE route is not claimed as SENT'); eq(r.delivered, false, 'delivered=false');
  const entry = audit.readVault().filter(e => e.action === 'ROUTE_LIVE').pop();
  ok(entry && entry.status !== 'SENT', 'ROUTE_LIVE audit is not SENT');
  setMode('DRY');

  console.log(`PASS: Customer #0 incoming/open + migration, repo won gate, founder-only sales, PENDING_DELIVERY (${n} assertions)`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
