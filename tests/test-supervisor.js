'use strict';
// utils/supervisor.js with fake child processes: crash-loop limit, consecutive
// failure counting, no respawn once shutdown starts, children awaited, SIGKILL
// fallback. No database needed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createSupervisor } = require('../utils/supervisor');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n += 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'teos-sup-'));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (_e) { return false; } };

// Fake child: appends its pid to <name>.starts, then behaves per MODE.
function script(name, body) {
  const f = path.join(tmp, name + '.js');
  fs.writeFileSync(f, `require('fs').appendFileSync(${JSON.stringify(path.join(tmp, name + '.starts'))}, process.pid + '\\n');\n${body}`);
  return f;
}
const starts = name => { const f = path.join(tmp, name + '.starts'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(Number) : []; };
const quiet = { log: () => {}, errorLog: () => {} };
function run(opts) {
  const result = { code: null, at: null };
  const sup = createSupervisor({ cwd: tmp, env: process.env, ...quiet, ...opts, exit: c => { result.code = c; result.at = Date.now(); } });
  return { sup, result };
}
const waitExit = async (result, ms = 8000) => { const t0 = Date.now(); while (result.code === null && Date.now() - t0 < ms) await sleep(25); return result.code; };

(async () => {
  try {
    // 1. Crash loop: spawning is not success. 4 consecutive failures => give up, exit 1,
    //    and the healthy sibling is terminated (no orphan).
    const healthy = script('web1', 'setInterval(() => {}, 1000);');
    const crasher = script('bot1', 'process.exit(1);');
    let { sup, result } = run({ services: [{ name: 'web1', file: healthy }, { name: 'bot1', file: crasher }], maxFailures: 4, backoffMs: 10, stableMs: 60000 });
    sup.start();
    eq(await waitExit(result), 1, 'crash loop ends with exit code 1');
    eq(starts('bot1').length, 4, 'bot started exactly maxFailures times (counter not reset by spawn)');
    await sleep(100);
    ok(starts('web1').every(p => !alive(p)), 'healthy sibling was terminated, no orphan');

    // 2. A child that stays up past stableMs counts as healthy: failures restart at 1.
    const flaky = script('bot2', 'setTimeout(() => process.exit(1), 250);');
    ({ sup, result } = run({ services: [{ name: 'bot2', file: flaky }], maxFailures: 3, backoffMs: 10, stableMs: 100 }));
    sup.start();
    await sleep(1500);
    ok(result.code === null && starts('bot2').length >= 4, `stable runs reset the counter (starts: ${starts('bot2').length}, still supervised)`);
    sup.shutdown(0, 'test');
    eq(await waitExit(result), 0, 'plain shutdown exits 0');

    // 3. SIGTERM during a pending restart timer: no new child is ever started.
    const quick = script('bot3', 'process.exit(1);');
    ({ sup, result } = run({ services: [{ name: 'bot3', file: quick }], maxFailures: 10, backoffMs: 600, stableMs: 60000 }));
    sup.start();
    await sleep(300);
    eq(starts('bot3').length, 1, 'one start before the restart timer fires');
    sup.shutdown(0, 'SIGTERM');
    eq(await waitExit(result), 0, 'shutdown during backoff exits 0');
    await sleep(1000);
    eq(starts('bot3').length, 1, 'restart timer was cancelled: no child started after shutdown');
    ok(sup.isShuttingDown(), 'supervisor reports shutting down');

    // 4. Shutdown waits for children to actually exit.
    const slow = script('web4', "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 400)); setInterval(() => {}, 1000);");
    ({ sup, result } = run({ services: [{ name: 'web4', file: slow }], killAfterMs: 5000 }));
    sup.start();
    await sleep(400);
    const pid4 = starts('web4')[0];
    const t0 = Date.now();
    sup.shutdown(0, 'SIGTERM');
    eq(await waitExit(result), 0, 'exit 0 after the child exits on its own');
    ok(result.at - t0 >= 350, 'supervisor waited for the child to finish');
    ok(!alive(pid4), 'child is gone when the supervisor exits');

    // 5. A child that ignores SIGTERM is killed after killAfterMs and the exit is non-zero.
    const stubborn = script('web5', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);");
    ({ sup, result } = run({ services: [{ name: 'web5', file: stubborn }], killAfterMs: 400 }));
    sup.start();
    await sleep(400);
    const pid5 = starts('web5')[0];
    sup.shutdown(0, 'SIGTERM');
    eq(await waitExit(result), 1, 'unresponsive child forces a non-zero exit');
    await sleep(100);
    ok(!alive(pid5), 'unresponsive child was killed');
    console.log(`PASS: supervisor restart and shutdown rules (${n} assertions)`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(0);
})().catch(err => { console.error(err); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
