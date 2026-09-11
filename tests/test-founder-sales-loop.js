// tests/test-founder-sales-loop.js
//
// Regression test for the founder sales-loop 403 lockdown. The router's
// requireFounder middleware relied on req.isFounder, which no middleware
// ever set, so every /api/founder/sales-loop/* endpoint returned 403 even
// for the founder.
//
// requireFounderSession now derives isFounder from the validated server-side
// session (TEOS_FOUNDER_TELEGRAM_ID), never from client-supplied fields.
// This test drives the real Express router over HTTP and asserts:
//   - no session                           → 401
//   - valid session, non-founder            → 403
//   - valid founder session (was 403)      → 200 with ok:true
//   - pipeline/health endpoints resolve tenant-scoped data for the founder
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createMemoryAdapter } = require('../db/adapter');
const identity = require('../services/identity');
const sessionService = require('../services/session');
const founderSalesLoop = require('../server/founderSalesLoop');

let passed = 0;
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); passed++; };
const tru = (v, msg) => { assert.ok(v, msg); passed++; };

function start(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => resolve(server));
    server.on('error', reject);
  });
}

function call(port, { path, headers }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: headers || {}
    }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const adapter = createMemoryAdapter();
  const FID = 7720001;
  const prevFid = process.env.TEOS_FOUNDER_TELEGRAM_ID;
  process.env.TEOS_FOUNDER_TELEGRAM_ID = String(FID);

  const founder = await identity.ensureUser(adapter, FID, { display_name: 'Loop Founder' });
  await identity.onboardWorkspace(adapter, {
    ownerUserId: founder.id,
    companyName: 'Founder Loop Co',
    lang: 'en',
    plan: 'founder'
  });
  const nonFounder = await identity.ensureUser(adapter, 7720002, { display_name: 'Loop Member' });
  await identity.onboardWorkspace(adapter, {
    ownerUserId: nonFounder.id,
    companyName: 'Member Loop Co',
    lang: 'en',
    plan: 'growth'
  });

  const app = express();
  const requireFounder = sessionService.createRequireFounderSession(() => adapter);
  app.use('/api/founder/sales-loop', requireFounder, founderSalesLoop);
  const server = await start(app);
  const port = server.address().port;

  const founderSession = await sessionService.createSession(adapter, founder.id);
  const memberSession = await sessionService.createSession(adapter, nonFounder.id);

  try {
    // No session → 401 (fail-closed).
    let r = await call(port, { path: '/api/founder/sales-loop/status' });
    eq(r.status, 401, 'no session → 401');

    // Valid session, non-founder → 403 (authenticated but not authorized).
    r = await call(port, {
      path: '/api/founder/sales-loop/status',
      headers: { authorization: 'Bearer ' + memberSession.token }
    });
    eq(r.status, 403, 'non-founder with a valid session → 403');

    // Valid founder session → 200 (this was a dead 403 before the fix).
    r = await call(port, {
      path: '/api/founder/sales-loop/status',
      headers: { authorization: 'Bearer ' + founderSession.token }
    });
    eq(r.status, 200, 'founder session reaches the sales-loop router (was 403)');
    const statusBody = JSON.parse(r.body);
    tru(statusBody.ok === true, 'status endpoint returns ok:true');
    tru(statusBody.salesLoop && typeof statusBody.salesLoop.scheduler === 'object', 'status exposes scheduler state');

    // Pipeline endpoint resolves tenant-scoped founder data.
    r = await call(port, {
      path: '/api/founder/sales-loop/pipeline',
      headers: { authorization: 'Bearer ' + founderSession.token }
    });
    eq(r.status, 200, 'founder pipeline endpoint returns 200');
    const pipe = JSON.parse(r.body);
    eq(pipe.ok, true, 'pipeline returns ok:true');
    tru(pipe.pipeline && typeof pipe.pipeline.openDeals === 'number', 'pipeline payload exposes deal counts');

    // Health endpoint resolves tenant-scoped founder data.
    r = await call(port, {
      path: '/api/founder/sales-loop/health',
      headers: { authorization: 'Bearer ' + founderSession.token }
    });
    eq(r.status, 200, 'founder health endpoint returns 200');
    const health = JSON.parse(r.body);
    eq(health.ok, true, 'health returns ok:true');
    tru(health.health && typeof health.health.pipeline === 'object', 'health exposes pipeline summary');
  } finally {
    server.close();
    if (prevFid === undefined) delete process.env.TEOS_FOUNDER_TELEGRAM_ID;
    else process.env.TEOS_FOUNDER_TELEGRAM_ID = prevFid;
  }

  console.log(`\n\u2713 founder sales-loop auth (${passed} assertions passed)`);
  console.log('  no session 401 · non-founder 403 · founder 200 · pipeline/health workspace-scoped');
  process.exit(0);
})().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
