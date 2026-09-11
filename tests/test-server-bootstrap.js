// tests/test-server-bootstrap.js
//
// Characterization/regression test for the per-request reliability
// re-registration bug. server/index.js previously called
// installReliability('sentinel') inside the customer0 route handler, so every
// request stacked a fresh process.on('uncaughtException'), eventually
// producing "MaxListenersExceededWarning" and crashing the process.
//
// The install is now hoisted to module scope and runs exactly once at
// bootstrap. This test guards that property at the source level so a future
// edit cannot regress it without a deliberate review.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
const lines = src.split('\n');

// Exactly one process-level install, executed at module scope.
const installs = lines.filter(l => l.includes("installReliability('sentinel');"));
ok(installs.length === 1, 'installReliability("sentinel") is invoked exactly once (no per-request stacking)');

const installIdx = lines.findIndex(l => l.includes("installReliability('sentinel');"));
const appIdx = lines.findIndex(l => l.trim() === 'const app = express();');
ok(installIdx !== -1, 'reliability install is present');
ok(appIdx !== -1, 'express app bootstrap is present');
ok(installIdx < appIdx, 'reliability install runs at module bootstrap, before app/route definitions');

// The customer0 route no longer performs its own requires/install per request.
const routeIdx = lines.findIndex(l => l.includes("app.get('/approvals/customer0'"));
ok(routeIdx !== -1, 'customer0 route is defined');
const routeBlock = lines.slice(routeIdx, routeIdx + 30).join('\n');
ok(!routeBlock.includes('installReliability'), 'customer0 route does not re-register process handlers per request');
ok(!routeBlock.includes("require('./render')"), 'customer0 route does not shadow the module-level render import');
ok(!routeBlock.includes('require(__dirname'), 'customer0 route has no residual per-request requires');

console.log(`\n\u2713 server bootstrap reliability install (${passed} assertions passed)`);
console.log('  single module-scope install · before app bootstrap · no per-request re-registration');
process.exit(0);
