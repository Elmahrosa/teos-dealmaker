'use strict';
// PostgreSQL lifecycle integration test (isolated database only).
// Needs TEST_DATABASE_URL pointing at a DISPOSABLE database whose name contains
// "test" and whose schema is already migrated (node scripts/apply-migrations.js).
// Without it this suite reports a skip (exit 77). It never reads DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log('  - pg-lifecycle SKIPPED: TEST_DATABASE_URL not set (needs an isolated, migrated PostgreSQL)');
  process.exit(77);
}
if (!/\/[^/?]*test[^/?]*(\?|$)/i.test(url)) {
  console.error('refusing to run: TEST_DATABASE_URL database name must contain "test"');
  process.exit(2);
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = url;
const founderId = 7800000 + Math.floor(Math.random() * 900000);
process.env.TEOS_FOUNDER_TELEGRAM_ID = String(founderId);

const assert = require('assert');
const db = require('../db');
const seedMod = require('../services/founderSeed');
const { createTestPaymentVerifier, evidenceFor } = require('./helpers/testPaymentVerifier');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n += 1; };
const rejects = async (p, re, m) => { await assert.rejects(p, re, m); n += 1; };

(async () => {
  const adapter = db.createPgAdapter();
  const pool = db.getPool();
  const repos = db.createRepos(adapter);
  // Re-runnable on a shared disposable DB: the founder workspace slug is fixed,
  // so start from empty tenant tables (guarded above: database name contains 'test').
  await pool.query('TRUNCATE workspaces, users RESTART IDENTITY CASCADE');
  const verifier = createTestPaymentVerifier();
  const vr = db.createRepos(adapter, { paymentVerifier: verifier });

  // Customer #0 seed + legacy migration on real rows (same id, NUMERIC preserved).
  const seed = await seedMod.ensureFounderWorkspace(adapter);
  const wsId = seed.workspace.id;
  const c0 = seed.customer0;
  eq(c0.stage, 'incoming', 'pg seed stage'); eq(c0.status, 'open', 'pg seed status');
  await repos.deals.update(wsId, c0.id, { stage: 'active', status: 'active', deal_value: 4200.5 });
  await seedMod.ensureFounderWorkspace(adapter);
  const m = await repos.deals.get(wsId, c0.id);
  eq(m.id, c0.id, 'pg migration keeps id'); eq(m.stage, 'incoming', 'pg legacy migrated'); eq(m.status, 'open', 'pg legacy status');
  eq(Number(m.deal_value), 4200.5, 'pg NUMERIC preserved through migration');
  await seedMod.ensureFounderWorkspace(adapter);
  const mig = await pool.query("SELECT COUNT(*)::int AS n FROM audit_trail WHERE workspace_id=$1 AND action_type='CUSTOMER_ZERO_MIGRATED'", [wsId]);
  eq(mig.rows[0].n, 1, 'pg migration is idempotent (one audit row)');
  eq((await pool.query('SELECT COUNT(*)::int AS n FROM deals WHERE workspace_id=$1 AND company_name=$2', [wsId, c0.company_name])).rows[0].n, 1, 'no twin Customer #0');

  // Raw adapter guard on the pg adapter.
  await assert.rejects(async () => adapter.update('deals', { workspace_id: wsId, id: c0.id }, { stage: 'won' }), { code: 'WON_NOT_VERIFIED' }); n += 1;
  await assert.rejects(async () => adapter.insert('deals', { workspace_id: wsId, company_name: 'Raw', stage: 'won', status: 'closed' }), { code: 'WON_NOT_VERIFIED' }); n += 1;
  await rejects(vr.deals.closeWon(wsId, c0.id, evidenceFor(verifier, { amount: 4200.5, tag: 'pg-c0' })), /protected_deal_cannot_be_won/, 'pg Customer #0 cannot be won');
  eq((await repos.deals.get(wsId, c0.id)).stage, 'incoming', 'pg Customer #0 still incoming');

  // NUMERIC(12,2) comes back as a string; amount/currency comparison must hold.
  const deal = await repos.deals.create({ workspace_id: wsId, company_name: 'PG Acme', stage: 'closing', deal_value: 100.10, currency: 'USD' });
  const raw = await pool.query('SELECT deal_value, pg_typeof(deal_value)::text AS t FROM deals WHERE id=$1', [deal.id]);
  eq(typeof raw.rows[0].deal_value, 'string', 'NUMERIC arrives as string'); eq(raw.rows[0].t, 'numeric', 'column is numeric');
  const good = evidenceFor(verifier, { amount: 100.1, tag: 'pg-ok' });
  const off = evidenceFor(verifier, { amount: 100.11, tag: 'pg-off' });
  await rejects(vr.deals.closeWon(wsId, deal.id, off), /won_requires/, 'pg amount off by one cent refused');
  const cur = evidenceFor(verifier, { amount: 100.1, currency: 'EUR', tag: 'pg-eur' });
  await rejects(vr.deals.closeWon(wsId, deal.id, cur), /won_requires/, 'pg currency mismatch refused');
  await rejects(repos.deals.closeWon(wsId, deal.id, good), /no_trusted_payment_verifier_configured/, 'pg no verifier => refused');
  eq((await repos.deals.get(wsId, deal.id)).stage, 'closing', 'pg deal untouched after refusals');
  const won = await vr.deals.closeWon(wsId, deal.id, good);
  eq(won.stage, 'won', 'pg closeWon stage'); eq(won.status, 'closed', 'pg closeWon status');

  // Concurrency: many simultaneous wins of one deal => one transition.
  const race = await repos.deals.create({ workspace_id: wsId, company_name: 'PG Race', stage: 'closing', deal_value: 50, currency: 'USD' });
  const rev = evidenceFor(verifier, { amount: 50, tag: 'pg-race' });
  const res = await Promise.all(Array.from({ length: 12 }, () => vr.deals.closeWon(wsId, race.id, rev)));
  ok(res.every(r => r && r.stage === 'won'), 'every concurrent caller sees won');
  const ev = await pool.query("SELECT COUNT(*)::int AS n FROM pipeline_events WHERE deal_id=$1 AND to_stage='won'", [race.id]);
  eq(ev.rows[0].n, 1, 'exactly one won event under concurrency');

  // ---- Atomicity: failure injection inside closeWon's transaction ---------
  const audit = require('../utils/auditLogger');
  const dealWonRows = async dealId => (await pool.query("SELECT COUNT(*)::int AS n FROM audit_trail WHERE deal_id=$1 AND action_type='DEAL_WON'", [dealId])).rows[0].n;
  const wonEvents = async dealId => (await pool.query("SELECT COUNT(*)::int AS n FROM pipeline_events WHERE deal_id=$1 AND to_stage='won'", [dealId])).rows[0].n;
  const state = async dealId => (await pool.query('SELECT stage, status FROM deals WHERE id=$1', [dealId])).rows[0];
  async function inject(table, cond, dealId) {
    await pool.query(`CREATE OR REPLACE FUNCTION teos_test_fail() RETURNS trigger AS $$ BEGIN IF ${cond} AND NEW.deal_id = ${Number(dealId)} THEN RAISE EXCEPTION 'injected_failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`DROP TRIGGER IF EXISTS teos_test_fail ON ${table}`);
    await pool.query(`CREATE TRIGGER teos_test_fail BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION teos_test_fail()`);
  }
  const clear = table => pool.query(`DROP TRIGGER IF EXISTS teos_test_fail ON ${table}`);

  // (a) event insert fails AFTER the conditional deal update succeeded.
  const fa = await repos.deals.create({ workspace_id: wsId, company_name: 'PG Inject A', stage: 'closing', deal_value: 75, currency: 'USD' });
  const fev = evidenceFor(verifier, { amount: 75, tag: 'pg-inj-a' });
  await inject('pipeline_events', "NEW.to_stage = 'won'", fa.id);
  await rejects(vr.deals.closeWon(wsId, fa.id, fev), /injected_failure/, 'event-insert failure surfaces to caller');
  let st = await state(fa.id);
  eq(st.stage, 'closing', 'deal stage rolled back after event failure'); eq(st.status, 'open', 'deal status rolled back');
  eq(await wonEvents(fa.id), 0, 'no orphaned won event'); eq(await dealWonRows(fa.id), 0, 'no DEAL_WON audit row');
  eq(audit.readVault().filter(e => e.action === 'DEAL_WON' && e.details && e.details.dealId === fa.id).length, 0, 'no vault DEAL_WON for a rolled-back win');
  await clear('pipeline_events');
  const retryA = await vr.deals.closeWon(wsId, fa.id, fev);
  eq(retryA.stage, 'won', 'retry succeeds after injection removed'); eq(await wonEvents(fa.id), 1, 'retry writes exactly one event'); eq(await dealWonRows(fa.id), 1, 'retry writes exactly one DEAL_WON row');

  // (b) audit_trail insert (last statement) fails: the earlier update+event roll back too.
  const fb = await repos.deals.create({ workspace_id: wsId, company_name: 'PG Inject B', stage: 'closing', deal_value: 80, currency: 'USD' });
  const fbev = evidenceFor(verifier, { amount: 80, tag: 'pg-inj-b' });
  await inject('audit_trail', "NEW.action_type = 'DEAL_WON'", fb.id);
  await rejects(vr.deals.closeWon(wsId, fb.id, fbev), /injected_failure/, 'audit-insert failure surfaces');
  st = await state(fb.id);
  eq(st.stage, 'closing', 'stage rolled back after audit failure'); eq(st.status, 'open', 'status rolled back after audit failure');
  eq(await wonEvents(fb.id), 0, 'event rolled back with the failed audit insert');
  await clear('audit_trail');
  eq((await vr.deals.closeWon(wsId, fb.id, fbev)).stage, 'won', 'retry after audit failure succeeds');
  eq(await wonEvents(fb.id), 1, 'one event after retry'); eq(await dealWonRows(fb.id), 1, 'one DEAL_WON row after retry');

  // (c) concurrent + repeated: one transition, one event, one DEAL_WON row.
  eq(await wonEvents(race.id), 1, 'race deal: one event'); eq(await dealWonRows(race.id), 1, 'race deal: one DEAL_WON audit row');
  await vr.deals.closeWon(wsId, race.id, rev);
  eq(await dealWonRows(race.id), 1, 'repeat close adds no audit row');

  // (d) vault write failing after commit is reported, not hidden.
  const fd = await repos.deals.create({ workspace_id: wsId, company_name: 'PG Vault Fail', stage: 'closing', deal_value: 60, currency: 'USD' });
  const fdev = evidenceFor(verifier, { amount: 60, tag: 'pg-vault' });
  const realWrite = audit.writeEntry;
  const origErr = console.error; const errs = []; console.error = (...a) => errs.push(a.join(' '));
  audit.writeEntry = (action, ...rest) => { if (action === 'DEAL_WON') throw new Error('vault_disk_full'); return realWrite(action, ...rest); };
  let vres;
  try { vres = await vr.deals.closeWon(wsId, fd.id, fdev); } finally { audit.writeEntry = realWrite; console.error = origErr; }
  eq(vres.stage, 'won', 'win committed'); eq(vres.audit_vault, 'FAILED', 'vault failure is reported to the caller');
  eq(await dealWonRows(fd.id), 1, 'DB audit row exists for reconciliation');
  ok(errs.some(e => /vault audit write failed after commit/.test(e)), 'vault failure logged loudly');

  // ---- Transactional outbox: commit, crash before vault, recovery ----------
  const outbox = require('../services/auditOutbox');
  const row = async dealId => (await pool.query("SELECT * FROM audit_outbox WHERE deal_id=$1 AND action='DEAL_WON'", [dealId])).rows;
  const vaultFor = eventId => audit.readVault().filter(e => e.details && e.details.eventId === eventId);

  // (e) outbox row committed with the win; crash window left it pending (deal fd above).
  const od = await row(fd.id);
  eq(od.length, 1, 'win committed exactly one outbox row'); eq(od[0].state, 'pending', 'undelivered event stays pending after the vault failure');
  ok(/^[0-9a-f-]{36}$/.test(od[0].event_id), 'outbox event has a stable UUID');
  ok(od[0].attempts >= 1 && /vault_disk_full/.test(od[0].last_error || ''), 'delivery failure recorded on the row (attempts, last_error)');
  eq(vaultFor(od[0].event_id).length, 0, 'no vault entry yet (interrupted before delivery)');
  let c = await outbox.counts(adapter);
  ok(c.pending >= 1, 'pending count exposed');

  // (f) outbox insert is part of the transaction: failing it rolls the win back.
  const fo = await repos.deals.create({ workspace_id: wsId, company_name: 'PG Outbox Fail', stage: 'closing', deal_value: 55, currency: 'USD' });
  const foev = evidenceFor(verifier, { amount: 55, tag: 'pg-outbox' });
  await pool.query('CREATE OR REPLACE FUNCTION teos_test_ob_fail() RETURNS trigger AS $$ BEGIN IF NEW.deal_id = ' + Number(fo.id) + " THEN RAISE EXCEPTION 'outbox_injected'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql");
  await pool.query('DROP TRIGGER IF EXISTS teos_test_ob_fail ON audit_outbox');
  await pool.query('CREATE TRIGGER teos_test_ob_fail BEFORE INSERT ON audit_outbox FOR EACH ROW EXECUTE FUNCTION teos_test_ob_fail()');
  await rejects(vr.deals.closeWon(wsId, fo.id, foev), /outbox_injected/, 'outbox insert failure aborts the win');
  st = await state(fo.id);
  eq(st.stage, 'closing', 'deal rolled back with the outbox insert'); eq(await wonEvents(fo.id), 0, 'no pipeline event'); eq(await dealWonRows(fo.id), 0, 'no audit_trail row'); eq((await row(fo.id)).length, 0, 'no outbox row');
  await pool.query('DROP TRIGGER IF EXISTS teos_test_ob_fail ON audit_outbox');
  eq((await vr.deals.closeWon(wsId, fo.id, foev)).stage, 'won', 'retry after outbox failure wins'); eq((await row(fo.id)).length, 1, 'one outbox row after retry');

  // (g) recovery after the interruption: reconcile delivers pending events once.
  audit.clearVault();
  const pendingBefore = (await outbox.counts(adapter)).pending;
  ok(pendingBefore >= 1, 'pending events present before recovery');
  const rec1 = await outbox.reconcile(adapter);
  eq(rec1.failed, 0, 'reconcile delivered without failures'); eq(rec1.counts.pending, 0, 'nothing pending after reconcile'); eq(rec1.counts.failed, 0, 'nothing failed after reconcile');
  const od2 = (await row(fd.id))[0];
  eq(od2.state, 'delivered', 'event marked delivered'); ok(od2.vault_hash && od2.delivered_at, 'vault hash and time recorded');
  eq(vaultFor(od2.event_id).length, 1, 'exactly one vault entry for the recovered event');
  eq(vaultFor(od2.event_id)[0].hash, od2.vault_hash, 'row hash equals the vault entry hash');
  eq(audit.verifyVault().valid, true, 'chain valid after recovery');
  const vaultLen = audit.readVault().length;

  // (h) repeated reconciliation and duplicate delivery attempts add nothing.
  const rec2 = await outbox.reconcile(adapter);
  eq(rec2.processed, 0, 'second reconcile has nothing to do'); eq(audit.readVault().length, vaultLen, 'no new vault entries');
  const dupRow = (await row(fd.id))[0];
  const dup = await outbox.deliverEvent(adapter, dupRow);
  eq(dup.ok, true, 'duplicate delivery of a delivered event is a no-op'); eq(audit.readVault().length, vaultLen, 'duplicate delivery adds no entry');
  const stale = { ...dupRow, state: 'pending', vault_hash: null };
  const dup2 = await outbox.deliverEvent(adapter, stale);
  eq(dup2.ok, true, 'stale pending copy re-delivered idempotently'); eq(vaultFor(dupRow.event_id).length, 1, 'still exactly one vault entry for the event');
  await Promise.all([outbox.deliverEvent(adapter, stale), outbox.deliverEvent(adapter, stale), outbox.deliverEvent(adapter, stale)]);
  eq(vaultFor(dupRow.event_id).length, 1, 'concurrent duplicate deliveries still one vault entry');

  // (i) crash after the vault append but before the row is marked delivered.
  const fi = await repos.deals.create({ workspace_id: wsId, company_name: 'PG Mark Fail', stage: 'closing', deal_value: 45, currency: 'USD' });
  const fiev = evidenceFor(verifier, { amount: 45, tag: 'pg-mark' });
  const markFail = { ...adapter, update: (t, w, ch, cap) => (t === 'audit_outbox' ? Promise.reject(new Error('crash_before_mark')) : adapter.update(t, w, ch, cap)), findOne: adapter.findOne.bind(adapter), find: adapter.find.bind(adapter) };
  const origE = console.error; console.error = () => {};
  const closed = await db.createRepos(markFail, { paymentVerifier: verifier }).deals.closeWon(wsId, fi.id, fiev);
  console.error = origE;
  ok(closed.stage === 'won', 'win committed');
  const oi = (await row(fi.id))[0];
  eq(oi.state, 'pending', 'row still pending: not marked delivered without confirmation'); eq(vaultFor(oi.event_id).length, 1, 'vault entry was appended before the crash');
  const lenI = audit.readVault().length;
  const rec3 = await outbox.reconcile(adapter);
  eq(rec3.delivered, 1, 'reconcile marks it delivered'); eq(audit.readVault().length, lenI, 'recovery appended no duplicate'); eq(vaultFor(oi.event_id).length, 1, 'one vault entry after recovery');
  eq((await row(fi.id))[0].state, 'delivered', 'row delivered after recovery');

  // (j) invalid vault chain blocks delivery; never marked delivered; recovers once repaired.
  const fj = await repos.deals.create({ workspace_id: wsId, company_name: 'PG Broken Chain', stage: 'closing', deal_value: 35, currency: 'USD' });
  const fjev = evidenceFor(verifier, { amount: 35, tag: 'pg-chain' });
  const fs = require('fs'); const path = require('path');
  const vaultFile = path.join(__dirname, '..', 'data', 'vault', 'audit.log');
  const goodVault = fs.readFileSync(vaultFile, 'utf8');
  const lines = goodVault.trim().split('\n'); const tampered = JSON.parse(lines[0]); tampered.status = 'tampered';
  lines[0] = JSON.stringify(tampered); fs.writeFileSync(vaultFile, lines.join('\n') + '\n');
  eq(audit.verifyVault().valid, false, 'vault deliberately broken');
  const brokenLen = fs.readFileSync(vaultFile, 'utf8');
  console.error = () => {};
  const jr = await vr.deals.closeWon(wsId, fj.id, fjev);
  console.error = origE;
  eq(jr.stage, 'won', 'win commits independently of vault health'); eq(jr.audit_vault, 'FAILED', 'broken chain is reported, not a clean success');
  const oj = (await row(fj.id))[0];
  eq(oj.state, 'pending', 'event stays pending on a broken chain'); ok(/vault_chain_invalid/.test(oj.last_error), 'chain failure recorded');
  eq(fs.readFileSync(vaultFile, 'utf8'), brokenLen, 'nothing appended to a broken vault');
  console.error = () => {};
  for (let i = 0; i < outbox.MAX_ATTEMPTS; i += 1) await outbox.reconcile(adapter);
  console.error = origE;
  const ojf = (await row(fj.id))[0];
  eq(ojf.state, 'failed', 'repeated failures end as failed, still retained'); ok(ojf.attempts >= outbox.MAX_ATTEMPTS, 'attempts counted');
  c = await outbox.counts(adapter);
  ok(c.failed >= 1, 'failed count exposed');
  fs.writeFileSync(vaultFile, goodVault); // repair
  const rec4 = await outbox.reconcile(adapter);
  eq(rec4.delivered, 1, 'failed event recovered after the chain is repaired'); eq((await row(fj.id))[0].state, 'delivered', 'delivered after repair');
  eq(vaultFor(oj.event_id).length, 1, 'exactly one vault entry for the recovered event');
  eq(audit.verifyVault().valid, true, 'chain valid after recovery');
  c = await outbox.counts(adapter);
  eq(c.pending, 0, 'no pending left'); eq(c.failed, 0, 'no failed left');
  const allIds = (await pool.query('SELECT event_id FROM audit_outbox')).rows.map(r => r.event_id);
  eq(new Set(allIds).size, allIds.length, 'event ids unique');
  for (const id of allIds) ok(vaultFor(id).length <= 1, 'no event has more than one vault entry');
  await pool.query('DROP FUNCTION IF EXISTS teos_test_ob_fail() CASCADE');

  // ---- Cross-process delivery: advisory lock, two independent connections ----
  {
    const { spawn } = require('child_process');
    const crypto = require('crypto');
    const runChild = (ids, extraEnv = {}) => new Promise(resolve => {
      const p = spawn(process.execPath, [require('path').join(__dirname, 'helpers', 'outboxDeliverChild.js'), ...ids], { env: { ...process.env, DATABASE_URL: url, ...extraEnv } });
      let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
      p.on('close', code => resolve({ code, out }));
    });
    const seedEvents = async k => {
      const ids = [];
      for (let i = 0; i < k; i += 1) {
        const id = crypto.randomUUID(); ids.push(id);
        await adapter.insert('audit_outbox', { event_id: id, workspace_id: wsId, deal_id: null, action: 'LOCK_PROBE', target: String(i), status: 'probe', details: { i }, state: 'pending', attempts: 0 });
      }
      return ids;
    };
    const entriesFor = id => audit.readVault().filter(e => e.details && e.details.eventId === id).length;
    audit.clearVault();

    // Same events attempted by 4 processes at once (+ this process): one entry each, chain intact.
    const ids = await seedEvents(6);
    const slow = { OUTBOX_TEST_SLOW: '1' }; // 40ms between lookup and append: provokes the race if the lock fails
    const kids = await Promise.all([runChild(ids, slow), runChild(ids.slice().reverse(), slow), runChild(ids, slow), runChild(ids.slice(0, 3), slow)]);
    for (const k of kids) ok(k.code === 0 && /RESULT/.test(k.out), 'child process delivered without crashing: ' + k.out.slice(0, 80));
    for (const id of ids) eq(entriesFor(id), 1, 'concurrent processes appended the event exactly once');
    eq(audit.verifyVault().valid, true, 'chain not forked by concurrent processes');
    eq(audit.readVault().length, ids.length, 'vault holds one entry per event, no extras');
    eq((await pool.query("SELECT COUNT(*)::int AS n FROM audit_outbox WHERE event_id = ANY($1) AND state='delivered'", [ids])).rows[0].n, ids.length, 'all events delivered');

    // Lock held by another connection: delivery backs off, event stays recoverable.
    const [busyId] = await seedEvents(1);
    const holder = await pool.connect();
    await holder.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [outbox.VAULT_LOCK]);
    const lenBusy = audit.readVault().length;
    const origE2 = console.error; console.error = () => {};
    const busyRow = await adapter.findOne('audit_outbox', { event_id: busyId });
    const br = await outbox.deliverEvent(adapter, busyRow, { lockWaitMs: 200 });
    console.error = origE2;
    eq(br.ok, false, 'delivery fails safely while the lock is held elsewhere'); eq(br.code, 'LOCK_BUSY', 'reported as lock busy');
    const bAfter = await adapter.findOne('audit_outbox', { event_id: busyId });
    eq(bAfter.state, 'pending', 'event stays pending'); eq(bAfter.attempts, 0, 'lock contention is not counted as a delivery failure'); eq(bAfter.last_error, 'vault_lock_busy', 'contention recorded');
    eq(audit.readVault().length, lenBusy, 'nothing appended without the lock');
    await holder.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [outbox.VAULT_LOCK]); holder.release();
    const okAfter = await outbox.reconcile(adapter);
    eq(okAfter.delivered, 1, 'recovered once the lock is free'); eq(entriesFor(busyId), 1, 'one vault entry after recovery');

    // Lock is released when the holder's connection dies (no stuck lock).
    const dying = await pool.connect();
    await dying.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [outbox.VAULT_LOCK]);
    dying.release(true); // destroys the session
    const [deadId] = await seedEvents(1);
    const dr = await outbox.deliverByEventId(adapter, deadId);
    eq(dr.ok, true, 'lock freed after the holding connection closed'); eq(entriesFor(deadId), 1, 'delivered after holder death');
    eq(audit.verifyVault().valid, true, 'chain valid');
    await pool.query("DELETE FROM audit_outbox WHERE action = 'LOCK_PROBE'");
  }

  // ---- Audit mirror: best-effort, never throws, repaired by reconciliation ----
  audit.clearVault();
  await pool.query("CREATE OR REPLACE FUNCTION teos_test_mirror_fail() RETURNS trigger AS $$ BEGIN IF NEW.action_type = 'MIRROR_PROBE' THEN RAISE EXCEPTION 'mirror_injected'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql");
  await pool.query('DROP TRIGGER IF EXISTS teos_test_mirror_fail ON audit_trail');
  await pool.query('CREATE TRIGGER teos_test_mirror_fail BEFORE INSERT ON audit_trail FOR EACH ROW EXECUTE FUNCTION teos_test_mirror_fail()');
  const merrs = []; console.error = (...a) => merrs.push(a.join(' '));
  let entry;
  try {
    entry = audit.writeEntry('MIRROR_PROBE', 'probe', 'success', { n: 1 });
    await new Promise(r => setTimeout(r, 600));
  } finally { console.error = origErr; }
  ok(entry && entry.hash, 'writeEntry does not throw when the mirror fails');
  eq(audit.verifyVault().valid, true, 'vault chain valid');
  ok(audit.readVault().some(e => e.action === 'MIRROR_PROBE'), 'authoritative vault has the entry');
  eq((await pool.query("SELECT COUNT(*)::int AS n FROM audit_trail WHERE action_type='MIRROR_PROBE'")).rows[0].n, 0, 'mirror row absent (best-effort failure)');
  ok(merrs.some(e => /mirror failed/.test(e)), 'mirror failure logged');
  await pool.query('DROP TRIGGER IF EXISTS teos_test_mirror_fail ON audit_trail');
  const r1 = await audit.syncVaultToDb();
  eq(r1.inserted, 1, 'reconciliation inserts the missing entry'); eq(r1.failed, 0, 'no failures');
  const r2 = await audit.syncVaultToDb();
  eq(r2.inserted, 0, 'reconciliation is idempotent'); eq(r2.skipped, 1, 'existing entry skipped');
  eq((await pool.query("SELECT COUNT(*)::int AS n FROM audit_trail WHERE action_type='MIRROR_PROBE'")).rows[0].n, 1, 'exactly one reconciled row');

  // Transaction rollback behaviour of the adapter's transaction helper.
  const before = (await pool.query('SELECT COUNT(*)::int AS n FROM deals WHERE workspace_id=$1', [wsId])).rows[0].n;
  await assert.rejects(adapter.transaction(async client => {
    await client.query("INSERT INTO deals (workspace_id, company_name) VALUES ($1, 'Rolled Back')", [wsId]);
    throw new Error('forced');
  }), /forced/); n += 1;
  eq((await pool.query('SELECT COUNT(*)::int AS n FROM deals WHERE workspace_id=$1', [wsId])).rows[0].n, before, 'rollback leaves no row');

  console.log(`PASS: PostgreSQL lifecycle (${n} assertions)`);
  await pool.query('DROP FUNCTION IF EXISTS teos_test_fail() CASCADE');
  await pool.query('DROP FUNCTION IF EXISTS teos_test_mirror_fail() CASCADE');
  await pool.end();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
