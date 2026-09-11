// scripts/prod.js
// Production entrypoint: runs the web server (server/index.js) and the
// Telegram bot (bot/index.js) as supervised child processes. Used by
// `npm run start:all` for single-command deployment (Hostinger Node.js
// hosting, Railway, VPS). Both children are restarted on crash (with a
// capped backoff) and terminated together on SIGTERM/SIGINT.
//
// Before spawning services it applies pending DB migrations when
// DATABASE_URL is present, so a fresh/restored Postgres deploy never starts
// against an empty schema.
'use strict';

// Load .env BEFORE anything reads process.env. scripts/prod.js spawns
// children that inherit this process's environment, and the TEOS_MODE gate
// below (getMode) must see LIVE from .env — otherwise a deployment that only
// sets TEOS_MODE in .env would be warned as DRY.
require('dotenv').config();
const { assertEnv } = require('../config/env');

assertEnv();

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { install: installReliability } = require('../utils/reliability');
const { getMode } = require('../config/mode');

installReliability('prod');

const root = path.join(__dirname, '..');

const SERVICES = [
  { name: 'web', file: path.join(root, 'server', 'index.js'), restart: 0 },
  { name: 'bot', file: path.join(root, 'bot', 'index.js'), restart: 0 }
];

const MAX_RESTARTS = 10;
const BACKOFF_MS = 2000;

const children = new Map();
let shuttingDown = false;

function runMigrations() {
  if (!process.env.DATABASE_URL) {
    console.log('[prod] DATABASE_URL not set — skipping DB migration check (memory-mode/dev)');
    return;
  }
  console.log('[prod] applying pending DB migrations before startup...');
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'apply-migrations.js')], {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`[prod] DB migration failed (exit ${result.status}) — aborting startup. Fix DATABASE_URL/schema and redeploy.`);
    process.exit(1);
  }
  console.log('[prod] DB migrations up to date');
}

function start(service) {
  let child;
  try {
    child = spawn(process.execPath, [service.file], {
      cwd: root,
      env: process.env,
      stdio: 'inherit'
    });
  } catch (err) {
    console.error(`[prod] failed to spawn ${service.name}:`, err.message);
    process.exit(1);
  }

  child.on('spawn', () => {
    service.restart = 0;
    console.log(`[prod] ${service.name} started (pid ${child.pid})`);
  });

  // A spawn failure (e.g. ENOENT on the target file) emits 'error' — without a
  // listener the parent would throw and crash. Fail the whole container instead.
  child.on('error', (err) => {
    console.error(`[prod] ${service.name} process error:`, err.message);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    console.log(`[prod] ${service.name} exited (code=${code} signal=${signal})`);
    if (shuttingDown) return;
    if (service.restart >= MAX_RESTARTS) {
      console.error(`[prod] ${service.name} exceeded ${MAX_RESTARTS} restarts — giving up. Exiting so the orchestrator restarts the container.`);
      process.exit(1);
    }
    service.restart += 1;
    const delay = Math.min(BACKOFF_MS * Math.pow(2, service.restart - 1), 30000);
    console.log(`[prod] restarting ${service.name} in ${delay}ms (attempt ${service.restart})`);
    setTimeout(() => start(service), delay);
  });

  children.set(service.name, child);
}

function shutdown() {
  shuttingDown = true;
  console.log('[prod] shutting down — sending SIGTERM to children');
  for (const [name, child] of children.entries()) {
    try {
      child.kill('SIGTERM');
      console.log(`[prod] sent SIGTERM to ${name} (pid ${child.pid})`);
    } catch (_) { /* ignore */ }
  }
  setTimeout(() => {
    console.log('[prod] force exit after timeout');
    process.exit(0);
  }, 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Mode contract: production supervision should never silently run the bot in
// DRY mode while an operator believes it is live. Surface the runtime mode
// loudly at startup so Railway/Hostinger logs make the state unambiguous.
if (getMode() !== 'LIVE') {
  console.warn(`[prod] WARNING: TEOS_MODE is not LIVE (current: ${getMode()}). ` +
    'Agents will log/vault output but nothing is sent to customers. ' +
    'Set TEOS_MODE=LIVE in the environment to run live.');
} else {
  console.log('[prod] bot running in LIVE mode (TEOS_MODE=LIVE)');
}

runMigrations();

for (const service of SERVICES) start(service);
