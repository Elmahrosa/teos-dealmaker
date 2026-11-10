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

const { spawnSync } = require('child_process');
const path = require('path');
const { install: installReliability } = require('../utils/reliability');
const { getMode } = require('../config/mode');
const { createSupervisor } = require('../utils/supervisor');

installReliability('prod');

const root = path.join(__dirname, '..');

const SERVICES = [
  { name: 'web', file: path.join(root, 'server', 'index.js') },
  { name: 'bot', file: path.join(root, 'bot', 'index.js') }
];

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

// Restart policy: 10 consecutive failures end the container with exit 1 (a child
// counts as healthy again only after 60s of uptime). SIGTERM stops children
// first and exits only after they are gone.
const supervisor = createSupervisor({ services: SERVICES, cwd: root, env: process.env });

process.on('SIGTERM', () => supervisor.shutdown(0, 'SIGTERM'));
process.on('SIGINT', () => supervisor.shutdown(0, 'SIGINT'));

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

supervisor.start();
