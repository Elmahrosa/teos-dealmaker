// tests/test-report-access.js
//
// Founder-report access control (Phase 3): /reports, /api/reports/latest and
// /customer-0 render the FOUNDER workspace's mission report. They are now
// gated by the same founder-session middleware used across the command center
// (sessionService.requireFounderSession): unauthenticated -> 401, non-founder
// session -> 403, founder session -> report content. The shareable public
// surface /report/:reportToken remains token-addressable (unguessable 192-bit
// token, 404 for anything else) and never responds to a bare numeric plan id.
//
// Handlers below mirror server/index.js routes (lines 568-642); the gate is
// the real factory used by the server.
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createMemoryAdapter } = require('../db/adapter');
const identity = require('../services/identity');
const sessionService = require('../services/session');
const founderSeed = require('../services/founderSeed');
const missionReport = require('../services/missionReport');
const render = require('../server/render');

let passed = 0;
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); passed++; };
const tru = (v, msg) => { assert.ok(v, msg); passed++; };

function start(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => resolve(server));
    server.on('error', reject);
  });
}

function call(port, { path, headers = {}, method = 'GET' }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const adapter = createMemoryAdapter();
  const FID = 7720003;
  const prevFid = process.env.TEOS_FOUNDER_TELEGRAM_ID;
  process.env.TEOS_FOUNDER_TELEGRAM_ID = String(FID);

  // Seed founder user + founder workspace + a plan (with report_token), the
  // exact data the public/founder surfaces would serve.
  const founder = await identity.ensureUser(adapter, FID, { display_name: 'Report Founder' });
  const bootstrap = await founderSeed.bootstrapFounder(adapter);
  tru(bootstrap.seeded, 'founder workspace + mission seeded for the report test');
  const ws = await adapter.findOne('workspaces', { slug: founderSeed.FOUNDER_WORKSPACE_SLUG });
  tru(ws, 'founder workspace exists');
  const { createRepos } = require('../db/repos');
  const repos = createRepos(adapter);
  const plans = await repos.plans.list(ws.id);
  tru(plans.length >= 1, 'founder plan exists');
  const plan = plans[0];
  tru(/^[a-f0-9]{8,64}$/.test(plan.report_token), 'plan carries an unguessable report token');

  const nonFounder = await identity.ensureUser(adapter, 7720004, { display_name: 'Report Member' });

  // All three founder surfaces plus the public token surface, wired exactly
  // like server/index.js (with the founder gate on the founder surfaces).
  const checkFounder = sessionService.createRequireFounderSession(() => adapter);
  const app = express();
  app.get('/report/:reportToken', async (req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    const token = String(req.params.reportToken || '').trim();
    if (!token || !/^[a-f0-9]{8,64}$/.test(token)) return res.status(404).type('html').send('Mission report not found');
    const planRow = await adapter.findOne('plans', { report_token: token });
    if (!planRow) return res.status(404).type('html').send('Mission report not found');
    const report = await missionReport.missionReport(adapter, planRow.workspace_id, planRow.id);
    if (!report) return res.status(404).type('html').send('Mission report not found');
    res.type('html').send(render.renderMissionReport(report));
  });
  app.get('/customer-0', checkFounder, async (_req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    const found = await adapter.findOne('workspaces', { slug: founderSeed.FOUNDER_WORKSPACE_SLUG });
    const wsRow = found;
    const wsPlans = await repos.plans.list(wsRow.id);
    if (!wsRow || !wsPlans.length) {
      return res.status(404).type('html').send('Customer #0 reference not provisioned on this instance');
    }
    const report = await missionReport.missionReport(adapter, wsRow.id, wsPlans[0].id);
    if (!report) return res.status(404).type('html').send('Customer #0 mission report not found');
    res.type('html').send(render.renderCustomerZero(report));
  });
  app.get('/reports', checkFounder, async (_req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    const found = await adapter.findOne('workspaces', { slug: founderSeed.FOUNDER_WORKSPACE_SLUG });
    const wsPlans = found ? await repos.plans.list(found.id) : [];
    const sorted = [...wsPlans].sort((a, b) => (b.id || 0) - (a.id || 0));
    const report = sorted.length ? await missionReport.missionReport(adapter, found.id, sorted[0].id) : null;
    if (!report) return res.status(404).type('html').send('Mission report not found');
    res.type('html').send(render.renderMissionReport(report));
  });
  app.get('/api/reports/latest', checkFounder, async (_req, res) => {
    const found = await adapter.findOne('workspaces', { slug: founderSeed.FOUNDER_WORKSPACE_SLUG });
    const wsPlans = found ? await repos.plans.list(found.id) : [];
    const sorted = [...wsPlans].sort((a, b) => (b.id || 0) - (a.id || 0));
    const report = sorted.length ? await missionReport.missionReport(adapter, found.id, sorted[0].id) : null;
    if (!report) return res.status(404).json({ error: 'report_not_found' });
    res.json({ ok: true, report });
  });

  const server = await start(app);
  const port = server.address().port;

  try {
    // ---- unauthenticated: every founder surface denies with 401
    for (const p of ['/reports', '/api/reports/latest', '/customer-0']) {
      const r = await call(port, { path: p });
      eq(r.status, 401, `unauthenticated ${p} -> 401`);
      tru(/Authentication required/.test(r.body), `no leak: ${p} returns the neutral auth error`);
      eq(r.headers['access-control-allow-origin'], undefined, `no CORS header lets browsers read ${p}`);
    }

    // ---- invalid session token: 401
    const forged = await call(port, { path: '/reports', headers: { Authorization: 'Bearer forgedtokenforgedtokenforgedtoken1234' } });
    eq(forged.status, 401, 'invalid session -> 401');

    // ---- valid session, non-founder: 403
    const memberSession = await sessionService.createSession(adapter, nonFounder.id);
    const memberRes = await call(port, { path: '/reports', headers: { Authorization: `Bearer ${memberSession.token}` } });
    eq(memberRes.status, 403, 'non-founder session -> 403');
    tru(/founder access required/i.test(memberRes.body), 'non-founder sees the neutral 403 error');

    // ---- authorized founder: reports render
    const founderSession = await sessionService.createSession(adapter, founder.id);
    const founderAuth = { Authorization: `Bearer ${founderSession.token}` };
    const api = await call(port, { path: '/api/reports/latest', headers: founderAuth });
    eq(api.status, 200, 'founder session can read /api/reports/latest');
    const json = JSON.parse(api.body);
    tru(json.ok === true && json.report, 'founder API report payload present');
    tru(JSON.stringify(json.report).length > 10, 'founder report payload carries content');
    const html = await call(port, { path: '/reports', headers: founderAuth });
    eq(html.status, 200, 'founder session can read /reports');
    tru(/<!DOCTYPE html>/i.test(html.body), '/reports is HTML for an authorized founder');
    const c0 = await call(port, { path: '/customer-0', headers: founderAuth });
    eq(c0.status, 200, 'founder session can read /customer-0');

    // ---- public shareable surface still works WITHOUT auth (by token only)
    const pub = await call(port, { path: `/report/${plan.report_token}` });
    eq(pub.status, 200, 'token-addressable public report still loads without a session');
    tru(!/Authentication required/.test(pub.body), 'token surface was never session-gated');

    // ---- identifier manipulation: a bare numeric id leaks nothing
    const num = await call(port, { path: '/report/1' });
    eq(num.status, 404, 'numeric plan id -> 404 (no enumeration leak)');
    const guess = await call(port, { path: `/report/${'0'.repeat(64)}` });
    eq(guess.status, 404, 'wrong token -> 404');

    // ---- missing report: founder-session request returns the clean 404
    await adapter.delete('plans', { id: plan.id });
    const missing = await call(port, { path: '/api/reports/latest', headers: founderAuth });
    eq(missing.status, 404, 'missing report for an authorized founder -> 404');
    eq(missing.body, JSON.stringify({ error: 'report_not_found' }), 'missing-report error carries no report contents');
  } finally {
    server.close();
    if (prevFid === undefined) delete process.env.TEOS_FOUNDER_TELEGRAM_ID;
    else process.env.TEOS_FOUNDER_TELEGRAM_ID = prevFid;
  }

  console.log(`✓ report access control (${passed} assertions passed)`);
  console.log('  founder surfaces 401/403 unauth · founder 200 · token surface public');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
