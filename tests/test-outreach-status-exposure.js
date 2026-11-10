'use strict';
// Public vs founder-only outreach status, against the REAL server process.
// Public /api/outreach/status must carry only coarse state; the detailed view is
// /api/outreach/health behind the audit key. With TEST_DATABASE_URL set the body
// contents are checked against a real migrated PostgreSQL; without it only the
// access control and the no-leak-on-error behaviour are checked.
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n += 1; };
const KEY = 'test-only-audit-key-not-secret';
const dbUrl = process.env.TEST_DATABASE_URL || '';
if (dbUrl && !/\/[^/?]*test[^/?]*(\?|$)/i.test(dbUrl)) { console.error('refusing: db name must contain "test"'); process.exit(2); }

const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SENSITIVE = ['last_error', 'from_email', 'limits', 'queue_counts', 'verified_domain', 'emergency_stop_env', 'last_successful_job', 'heartbeat_at', 'reason', 'resend', 'provider'];

(async () => {
  const port = await freePort();
  const env = { ...process.env, NODE_ENV: 'test', PORT: String(port), AUDIT_API_KEY: KEY, TEOS_FOUNDER_TELEGRAM_ID: '9300001' };
  delete env.DATABASE_URL; delete env.TELEGRAM_BOT_TOKEN;
  if (dbUrl) env.DATABASE_URL = dbUrl;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: 'ignore' });
  const get = (p, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, { headers }).then(async r => ({ status: r.status, text: await r.text() }));
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i += 1) { try { up = (await get('/health')).status === 200; } catch (_e) { await sleep(250); } }
    ok(up, 'server started');

    // Public liveness exposes only status and timestamp: no mode, counts or detail.
    const health = await get('/api/health');
    eq(health.status, 200, 'public health answers');
    eq(JSON.stringify(Object.keys(JSON.parse(health.text)).sort()), JSON.stringify(['status', 'timestamp']), 'public health has exactly status and timestamp');
    ok(!/mode|totalEntries|LIVE|DRY/.test(health.text), 'public health never exposes mode or entry counts');

    // Access control (needs no database).
    eq((await get('/api/outreach/health')).status, 401, 'detailed status refuses unauthenticated requests');
    eq((await get('/api/outreach/health', { 'x-api-key': 'wrong' })).status, 401, 'detailed status refuses a wrong key');
    const founder = await get('/api/outreach/health', { 'x-api-key': KEY });
    ok(founder.status !== 401 && founder.status !== 403, 'founder key is accepted by the detailed status');
    const pub = await get('/api/outreach/status');
    for (const k of SENSITIVE) ok(!pub.text.includes(k), `public status never contains ${k}`);
    ok(!/postgres|ECONN|password|stack/i.test(pub.text), 'public status never leaks error internals');

    if (dbUrl) {
      eq(pub.status, 200, 'public status answers');
      const body = JSON.parse(pub.text);
      eq(JSON.stringify(Object.keys(body).sort()), JSON.stringify(['ok', 'outbound_email', 'state']), 'public status has exactly ok, state, outbound_email');
      ok(typeof body.state === 'string' && /^(ENABLED|DISABLED)$/.test(body.outbound_email), 'public fields are coarse and well-formed');
      eq(founder.status, 200, 'founder detailed status answers');
      const detail = JSON.parse(founder.text);
      ok(detail.limits && detail.queue_counts && 'from_email' in detail && 'last_error' in detail, 'founder gets the full operational detail');
    }

    if (dbUrl) {
      // mission-increment: validation failure must not echo internal error text.
      const post = (p, body, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, text: await r.text() }));
      const creds = { email: `inc-${Date.now()}@example.test`, password: 'Correct-Horse-9', companyName: 'Increment Test Co' };
      eq((await post('/api/auth/signup', creds)).status, 201, 'test user signs up');
      const login = JSON.parse((await post('/api/auth/login', creds)).text);
      const inc = await post('/api/auth/missions/increment', { increment: 99999999 }, { authorization: `Bearer ${login.sessionToken}` });
      eq(inc.status, 400, 'oversized increment is rejected');
      ok(!/between|MAX|workspace not found|Error|at /.test(inc.text), 'increment error does not echo internal error text');
      eq(JSON.parse(inc.text).error, 'Unable to update mission usage', 'increment returns the generic message');
    }

    // Dashboard keeps working on the public fields only.
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard', 'index.html'), 'utf8');
    ok(/\/api\/outreach\/status/.test(html) && !/\/api\/outreach\/health/.test(html), 'dashboard reads only the public status');
    ok(!/queue_counts|last_successful_job|from_email|last_error/.test(html), 'dashboard no longer depends on founder-only fields');
    ok(!/health\.mode|health\.totalEntries/.test(html), 'dashboard no longer reads mode or totalEntries from health');
    eq(html, fs.readFileSync(path.join(__dirname, '..', 'hostinger', 'dashboard', 'index.html'), 'utf8'), 'hostinger dashboard copy matches');
    console.log(`PASS: outreach status exposure (${n} assertions${dbUrl ? ', with PostgreSQL' : ', no database: content checks skipped'})`);
  } finally {
    child.kill('SIGTERM');
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
