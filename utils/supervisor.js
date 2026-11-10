'use strict';
// Process supervisor used by scripts/prod.js. Kept separate so its restart and
// shutdown rules can be tested with fake child processes.
//
// Rules:
//  - Consecutive failures are counted. A child counts as healthy again only after
//    it has stayed up for stableMs; merely spawning proves nothing.
//  - After maxFailures consecutive failures the supervisor gives up: it stops the
//    other children and exits 1, so the platform sees a real failure.
//  - On shutdown no new child is started, pending restart timers are cancelled,
//    every child gets SIGTERM, and the supervisor exits only after they have
//    exited (SIGKILL after killAfterMs, exit code 1 in that case).
const { spawn } = require('child_process');

function createSupervisor(options) {
  const {
    services,
    cwd,
    env = process.env,
    maxFailures = 10,
    backoffMs = 2000,
    maxBackoffMs = 30000,
    stableMs = 60000,
    killAfterMs = 12000,
    log = console.log,
    errorLog = console.error,
    exit = (code) => process.exit(code)
  } = options;

  const state = new Map(); // name -> { child, failures, startedAt, timer, running }
  let shuttingDown = false;
  let exitCode = 0;
  let finished = false;

  function finish() {
    if (finished) return;
    finished = true;
    exit(exitCode);
  }

  function anyRunning() {
    for (const s of state.values()) if (s.running) return true;
    return false;
  }

  function begin(service) {
    if (shuttingDown) return;
    const s = state.get(service.name) || { failures: 0, running: false, timer: null, child: null };
    state.set(service.name, s);
    s.timer = null;
    let child;
    try {
      child = spawn(process.execPath, [service.file], { cwd, env, stdio: 'inherit' });
    } catch (err) {
      errorLog(`[prod] failed to spawn ${service.name}: ${err.message}`);
      return shutdown(1, `spawn failure of ${service.name}`);
    }
    s.child = child;
    s.running = true;
    child.on('spawn', () => {
      s.startedAt = Date.now();
      log(`[prod] ${service.name} started (pid ${child.pid})`);
    });
    child.on('error', (err) => {
      errorLog(`[prod] ${service.name} process error: ${err.message}`);
      s.running = false;
      shutdown(1, `process error in ${service.name}`);
    });
    child.on('exit', (code, signal) => {
      s.running = false;
      log(`[prod] ${service.name} exited (code=${code} signal=${signal})`);
      if (shuttingDown) {
        if (!anyRunning()) finish();
        return;
      }
      const upFor = s.startedAt ? Date.now() - s.startedAt : 0;
      s.failures = upFor >= stableMs ? 1 : s.failures + 1;
      if (s.failures >= maxFailures) {
        errorLog(`[prod] ${service.name} failed ${s.failures} times in a row — giving up and exiting so the platform sees a failed container.`);
        return shutdown(1, `${service.name} crash loop`);
      }
      const delay = Math.min(backoffMs * Math.pow(2, s.failures - 1), maxBackoffMs);
      log(`[prod] restarting ${service.name} in ${delay}ms (consecutive failure ${s.failures}/${maxFailures})`);
      s.timer = setTimeout(() => begin(service), delay);
    });
  }

  function shutdown(code = 0, reason = 'signal') {
    if (shuttingDown) { if (code && !exitCode) exitCode = code; return; }
    shuttingDown = true;
    exitCode = code;
    log(`[prod] shutting down (${reason}) — sending SIGTERM to children`);
    for (const [name, s] of state.entries()) {
      if (s.timer) { clearTimeout(s.timer); s.timer = null; }
      if (s.running && s.child) {
        try { s.child.kill('SIGTERM'); log(`[prod] sent SIGTERM to ${name} (pid ${s.child.pid})`); } catch (_) { /* already gone */ }
      }
    }
    if (!anyRunning()) return finish();
    const t = setTimeout(() => {
      errorLog('[prod] children did not exit in time — sending SIGKILL');
      exitCode = 1;
      for (const s of state.values()) if (s.running && s.child) { try { s.child.kill('SIGKILL'); } catch (_) { /* ignore */ } }
      setTimeout(finish, 500);
    }, killAfterMs);
    if (t.unref) t.unref();
  }

  function start() { for (const service of services) begin(service); }

  return { start, shutdown, state, isShuttingDown: () => shuttingDown };
}

module.exports = { createSupervisor };
