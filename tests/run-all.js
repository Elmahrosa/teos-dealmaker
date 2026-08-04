// tests/run-all.js
// Aggregate test runner: executes every test suite in tests/*.js plus
// agents/*/test.js as a child process and reports a combined summary.
// Run via `npm test`.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const testsDir = path.join(root, 'tests');

function discover() {
  const suites = [];
  for (const name of fs.readdirSync(testsDir)) {
    if (/\.test\.js$|^test-.+\.js$/.test(name)) suites.push(path.join(testsDir, name));
  }
  const agentsDir = path.join(root, 'agents');
  for (const dir of fs.readdirSync(agentsDir)) {
    const testPath = path.join(agentsDir, dir, 'test.js');
    if (fs.existsSync(testPath)) suites.push(testPath);
  }
  const pluginsDir = path.join(root, 'plugins');
  for (const dir of fs.readdirSync(pluginsDir)) {
    const testDir = path.join(pluginsDir, dir, 'tests');
    if (!fs.existsSync(testDir)) continue;
    for (const name of fs.readdirSync(testDir)) {
      if (/\.test\.js$|^test\.js$/.test(name)) suites.push(path.join(testDir, name));
    }
  }
  return suites.sort();
}

const suites = discover();
const results = [];

// Clean test environment: never let a local .env DATABASE_URL reach unit/DRY
// suites. Live/Supabase suites that intentionally need a real DB must set
// TEST_DATABASE_URL or re-inject DATABASE_URL themselves.
const testEnv = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL || '',
};

for (const file of suites) {
  const rel = path.relative(root, file);
  const res = spawnSync(process.execPath, [file], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    env: testEnv,
  });
  const ok = res.status === 0;
  results.push({ rel, ok, status: res.status, signal: res.signal });
  if (ok) {
    console.log(`\u2713 ${rel}`);
  } else {
    console.log(`\u2717 ${rel} (exit ${res.status === null ? res.signal : res.status})`);
  }
  const out = (res.stdout || '').trim().split('\n');
  const tail = out.slice(-4);
  if (tail.length) {
    for (const line of tail) console.log(`      ${line}`);
  }
  if (!ok && res.stderr) {
    const errTail = (res.stderr || '').trim().split('\n').slice(-6);
    for (const line of errTail) console.log(`      ! ${line}`);
  }
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\n${results.length} suites: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
