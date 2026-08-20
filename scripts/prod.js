// scripts/prod.js
// Production entrypoint: runs the web server (server/index.js) and the
// Telegram bot (bot/index.js) as supervised child processes. Used by
// `npm run start:all` for single-command deployment (Hostinger Node.js
// hosting, Railway, VPS). Both children are restarted on crash (with a
// capped backoff) and terminated together on SIGTERM/SIGINT.
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

const SERVICES = [
  { name: 'web', file: path.join(root, 'server', 'index.js'), restart: 0 },
  { name: 'bot', file: path.join(root, 'bot', 'index.js'), restart: 0 }
];

const MAX_RESTARTS = 10;
const BACKOFF_MS = 2000;

const children = new Map();
let shuttingDown = false;

function start(service) {
  const child = spawn(process.execPath, [service.file], {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  });

  child.on('spawn', () => {
    service.restart = 0;
    console.log(`[prod] ${service.name} started (pid ${child.pid})`);
  });

  child.on('exit', (code, signal) => {
    console.log(`[prod] ${service.name} exited (code=${code} signal=${signal})`);
    if (shuttingDown || signal === 'SIGTERM' || signal === 'SIGINT') return;
    if (service.restart >= MAX_RESTARTS) {
      console.error(`[prod] ${service.name} exceeded ${MAX_RESTARTS} restarts — giving up`);
      return;
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

for (const service of SERVICES) start(service);
