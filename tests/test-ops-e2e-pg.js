'use strict';
// Operational end-to-end check with REAL OS processes against a disposable,
// migrated PostgreSQL (TEST_DATABASE_URL, name must contain "test"; else exit 77).
// It runs a COPY of the repository in a temp dir so the audit vault file
// (data/vault/audit.log) is isolated from the working tree. It verifies:
//   - web startup, health, SIGTERM clean exit
//   - startup reconcile delivers committed-but-undelivered audit events once
//   - repeated restarts add nothing
//   - two web processes started together (a misconfiguration) still append each event once
//   - a damaged vault is never rewritten or rebuilt automatically; events stay pending
//     and recover only after the chain is repaired and reconcile is requested
const url = process.env.TEST_DATABASE_URL;
if (!url) { console.log('  - ops-e2e SKIPPED: TEST_DATABASE_URL not set'); process.exit(77); }
if (!/\/[^/?]*test[^/?]*(\?|$)/i.test(url)) { console.error('refusing: database name must contain "test"'); process.exit(2); }

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n += 1; };
const KEY = 'ops-e2e-key-not-secret';
const src = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'teos-ops-'));
const repo = path.join(tmp, 'repo');
fs.cpSync(src, repo, { recursive: true, filter: p => { const r = path.relative(src, p); return !(r === '.git' || r.startsWith('.git' + path.sep) || r === 'node_modules' || r === 'data' || r.startsWith('data' + path.sep) || r === '.env'); } });
fs.symlinkSync(path.join(src, 'node_modules'), path.join(repo, 'node_modules'));
const vaultFile = path.join(repo, 'data', 'vault', 'audit.log');
const baseEnv = { PATH: process.env.PATH, HOME: tmp, NODE_ENV: 'staging', DATABASE_URL: url, AUDIT_API_KEY: KEY, TEOS_FOUNDER_TELEGRAM_ID: '7700001', OUTBOX_RECONCILE_INTERVAL_MS: '0' };

function node(script, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, ['-e', script, ...args], { cwd: repo, env: { ...baseEnv, NODE_ENV: 'test', ...extraEnv }, encoding: 'utf8' });
}

// Seed: a workspace plus N deals closed while the vault write is failing, so the
// win and its outbox row are committed but nothing reached the vault.
function seed(label, count) {
  const r = node(`
    const db = require('./db'); const audit = require('./utils/auditLogger');
    const { createTestPaymentVerifier, evidenceFor } = require('./tests/helpers/testPaymentVerifier');
    (async () => {
      const adapter = db.createPgAdapter(); const pool = db.getPool();
      const verifier = createTestPaymentVerifier(); const vr = db.createRepos(adapter, { paymentVerifier: verifier });
      const ws = (await pool.query("SELECT id FROM workspaces ORDER BY id LIMIT 1")).rows[0] || (await pool.query("INSERT INTO workspaces (name, slug, plan, status) VALUES ('Ops E2E','ops-e2e','solo','active') RETURNING id")).rows[0];
      const real = audit.writeEntry; const e = console.error; console.error = () => {};
      audit.writeEntry = (a, ...rest) => { if (a === 'DEAL_WON') throw new Error('simulated_vault_outage'); return real(a, ...rest); };
      for (let i = 0; i < ${count}; i++) {
        const d = await db.createRepos(adapter).deals.create({ workspace_id: ws.id, company_name: '${label}-' + i, stage: 'closing', deal_value: 10 + i, currency: 'USD' });
        await vr.deals.closeWon(ws.id, d.id, evidenceFor(verifier, { amount: 10 + i, tag: '${label}-' + i }));
      }
      console.error = e; await pool.end(); console.log('SEEDED');
    })().catch(err => { console.log('SEED_ERR ' + err.message); process.exit(1); });`);
  ok(/SEEDED/.test(r.stdout), `seed ${label}: ${count} won deal(s) committed with the vault down ${r.stdout.slice(0, 80)}${r.stderr.slice(0, 200)}`);
}
const q = sql => spawnSync(process.execPath, ['-e', `const db=require('./db');db.getPool().query(${JSON.stringify(sql)}).then(r=>{console.log(JSON.stringify(r.rows));return db.getPool().end();})`], { cwd: repo, env: { ...baseEnv, NODE_ENV: 'test' }, encoding: 'utf8' }).stdout;
const counts = () => JSON.parse(q('SELECT state, count(*)::int AS c FROM audit_outbox GROUP BY state')).reduce((a, r) => ({ ...a, [r.state]: r.c }), { pending: 0, delivered: 0, failed: 0 });
const vaultLines = () => (fs.existsSync(vaultFile) ? fs.readFileSync(vaultFile, 'utf8').split('\n').filter(Boolean) : []);
const vaultValid = () => JSON.parse(node("console.log(JSON.stringify({v: require('./utils/auditLogger').verifyVault().valid}))").stdout.trim()).v;
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

async function startWeb() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.js'], { cwd: repo, env: { ...baseEnv, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  const exit = new Promise(res => child.on('exit', (code, sig) => res({ code, sig })));
  const t0 = Date.now(); let up = false;
  while (!up && Date.now() - t0 < 20000) { try { up = (await fetch(`http://127.0.0.1:${port}/health`)).status === 200; } catch (_e) { await sleep(150); } }
  return { child, port, exit, up, log: () => log, api: (p, opts = {}) => fetch(`http://127.0.0.1:${port}${p}`, { ...opts, headers: { 'x-api-key': KEY, ...(opts.headers || {}) } }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) })) };
}
const stopTimes = [];
async function stopWeb(w) { const t0 = Date.now(); w.child.kill('SIGTERM'); const r = await Promise.race([w.exit, sleep(14000).then(() => ({ code: 'TIMEOUT' }))]); stopTimes.push(Date.now() - t0); if (r.code === 'TIMEOUT') w.child.kill('SIGKILL'); return r; }
async function waitFor(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(200); } return false; }

(async () => {
  try {
    const clean = node("require('./db').getPool().query('TRUNCATE workspaces, users RESTART IDENTITY CASCADE').then(()=>process.exit(0))");
    eq(clean.status, 0, 'disposable database reset');

    // 1. committed-but-undelivered events are delivered by the real web process at startup.
    seed('crash', 2);
    eq(counts().pending, 2, 'two events pending, none in the vault');
    eq(vaultLines().filter(l => /DEAL_WON/.test(l)).length, 0, 'vault holds no DEAL_WON before startup');
    let w = await startWeb();
    ok(w.up, 'web process starts against PostgreSQL and answers /health');
    eq((await fetch(`http://127.0.0.1:${w.port}/api/outreach/health`)).status, 401, 'founder detail refuses anonymous access');
    ok(await waitFor(() => counts().pending === 0), 'startup reconcile delivers pending events');
    eq(counts().delivered, 2, 'both events marked delivered');
    eq(vaultLines().filter(l => /DEAL_WON/.test(l)).length, 2, 'exactly one vault entry per event');
    ok(vaultValid(), 'vault chain valid after recovery');
    const api = await w.api('/api/audit-outbox');
    eq(api.status, 200, 'founder outbox view answers'); eq(api.body.counts.failed, 0, 'no failed events reported');
    eq((await fetch(`http://127.0.0.1:${w.port}/api/audit-outbox`)).status, 401, 'outbox view refuses anonymous access');
    let ex = await stopWeb(w);
    ok(ex.code === 0 && !ex.sig, `SIGTERM exits cleanly (code ${ex.code})`);
    ok(/database pools closed: [1-9]/.test(w.log()), 'shutdown closed the PostgreSQL pool(s) itself');
    ok(stopTimes[stopTimes.length - 1] < 4000, `shutdown finished by itself in ${stopTimes[stopTimes.length - 1]}ms, not by the force-exit backstop`);
    ok(!/forcing exit/.test(w.log()), 'no forced exit');

    // 2. repeated restarts add nothing.
    const len = vaultLines().length;
    for (let i = 0; i < 2; i++) { w = await startWeb(); ok(w.up, `restart ${i + 1} answers /health`); await sleep(1500); ex = await stopWeb(w); ok(ex.code === 0, `restart ${i + 1} stops cleanly`); }
    eq(vaultLines().length, len, 'repeated startup reconciliation appended nothing');

    // 3. two web processes started together (misconfiguration) still deliver each event once.
    seed('race', 3);
    eq(counts().pending, 3, 'three new events pending');
    const [a, b] = await Promise.all([startWeb(), startWeb()]);
    ok(a.up && b.up, 'both processes start');
    ok(await waitFor(() => counts().pending === 0), 'events delivered');
    await sleep(1000);
    const won = vaultLines().filter(l => /DEAL_WON/.test(l));
    eq(won.length, 5, 'five DEAL_WON entries in total (2 + 3), no duplicates from the second process');
    eq(new Set(won.map(l => JSON.parse(l).details.eventId)).size, 5, 'every event id appears once');
    ok(vaultValid(), 'vault chain valid after the concurrent start');
    await Promise.all([stopWeb(a), stopWeb(b)]);

    // 4. damaged vault: no automatic rewrite or rebuild; events stay pending; manual recovery works.
    const good = fs.readFileSync(vaultFile);
    const lines = good.toString('utf8').split('\n');
    const idx = lines.findIndex(l => /DEAL_WON/.test(l));
    const bad = lines.slice(); const o = JSON.parse(bad[idx]); o.target = 'tampered'; bad[idx] = JSON.stringify(o);
    fs.writeFileSync(vaultFile, bad.join('\n'));
    const badHash = sha(vaultFile);
    ok(!vaultValid(), 'tampered vault is detected as invalid');
    seed('damaged', 1);
    w = await startWeb(); ok(w.up, 'web starts even with a damaged vault');
    await sleep(2500);
    eq(counts().pending + counts().failed, 1, 'the new event is not delivered into a damaged chain');
    eq(sha(vaultFile), badHash, 'damaged vault file was not modified, rebuilt or truncated');
    const st = await w.api('/api/audit-outbox'); eq(st.status, 200, 'outbox view still answers');
    const rec = await w.api('/api/audit-outbox/reconcile', { method: 'POST' });
    ok(rec.status === 502 && rec.body.ok === false, 'manual reconcile reports failure while the chain is broken');
    eq(sha(vaultFile), badHash, 'reconcile did not touch the damaged vault');
    // operator repairs the chain (restore the known-good file), then recovery is explicit.
    fs.writeFileSync(vaultFile, good);
    const rec2 = await w.api('/api/audit-outbox/reconcile', { method: 'POST' });
    eq(rec2.status, 200, 'reconcile succeeds after the chain is repaired');
    eq(counts().pending + counts().failed, 0, 'event delivered after repair');
    eq(vaultLines().filter(l => /DEAL_WON/.test(l)).length, 6, 'exactly one new entry');
    ok(vaultValid(), 'vault chain valid after manual recovery');
    ok((await stopWeb(w)).code === 0, 'final shutdown clean');
    ok(stopTimes.every(t => t < 4000), 'every shutdown finished without the backstop');
    console.log(`  shutdown times with PostgreSQL (ms): ${stopTimes.join(', ')}`);

    // 5. Real scripts/prod.js: web + a bot that crashes at once (no token). SIGTERM during the
    //    bot's restart backoff must stop everything, start no new bot, and leave no process.
    const pport = await freePort();
    const pj = spawn(process.execPath, ['scripts/prod.js'], { cwd: repo, env: { ...baseEnv, PORT: String(pport), BOT_POLLING: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let plog = ''; pj.stdout.on('data', d => { plog += d; }); pj.stderr.on('data', d => { plog += d; });
    const pexit = new Promise(res => pj.on('exit', (code, sig) => res({ code, sig })));
    let pup = false; const tp = Date.now();
    while (!pup && Date.now() - tp < 30000) { try { pup = (await fetch(`http://127.0.0.1:${pport}/health`)).status === 200; } catch (_e) { await sleep(200); } }
    ok(pup, 'prod.js starts the web service');
    ok(await waitFor(() => /bot exited/.test(plog), 10000), 'bot without a token exits (as expected here)');
    ok(/consecutive failure 1\/10/.test(plog), 'restart is counted as consecutive failure 1 of 10');
    const startsBefore = (plog.match(/bot started/g) || []).length;
    const ts = Date.now();
    pj.kill('SIGTERM');
    const pr = await Promise.race([pexit, sleep(15000).then(() => ({ code: 'TIMEOUT' }))]);
    eq(pr.code, 0, 'prod.js exits 0 on SIGTERM');
    ok(Date.now() - ts < 6000, `prod.js exited in ${Date.now() - ts}ms (children awaited, no fixed delay)`);
    await sleep(3500);
    eq((plog.match(/bot started/g) || []).length, startsBefore, 'no bot was started after SIGTERM');
    const left = spawnSync('pgrep', ['-f', repo + '/(server|bot)/index.js'], { encoding: 'utf8' }).stdout.trim();
    eq(left, '', 'no web or bot process is left behind');
    ok(/shutdown complete/.test(plog), 'web service shut down gracefully under prod.js');
    console.log(`PASS: operational end-to-end on PostgreSQL (${n} assertions)`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(0);
})().catch(err => { console.error(err); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
