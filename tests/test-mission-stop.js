// tests/test-mission-stop.js
//
// Pins the terminal Stop contract for missions (work-email spec fallback):
//   - stopMission sets a running/halted/paused plan to 'cancelled' (terminal)
//   - a cancelled plan CANNOT be resumed (runPlan/runMission refuses)
//   - stop on an already-terminal plan is a no-op (stopped:false + reason)
//   - pause also refuses to touch a cancelled plan
'use strict';

const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');
const runtime = require('../services/workforce/runtime');

(async () => {
  let n = 0;
  const check = (cond, msg) => { assert.ok(cond, msg); n += 1; };
  const equal = (a, b, msg) => { assert.strictEqual(a, b, msg); n += 1; };
  const throws = async (fn, re, msg) => {
    try { await fn(); } catch (err) {
      check(re.test(String(err.message)), `${msg} (got: ${err.message})`);
      return;
    }
    check(false, msg);
  };

  const adapter = createMemoryAdapter();
  const tg = 8842001;
  await identity.ensureUser(adapter, tg, { display_name: 'Stop Mission Founder' });
  const user = await identity.getUserByTelegram(adapter, tg);
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: user.id,
    companyName: 'Stop Mission Test',
    lang: 'en',
    plan: 'growth'
  });
  const wsId = ws.id;
  const repos = createRepos(adapter);
  const sub = await repos.subscriptions.get(wsId);
  await repos.subscriptions.update(sub.id, { status: 'active' });

  // ------------------------------------------------------------------
  // 1. A mission halting for approval can be stopped; stop is terminal.
  // ------------------------------------------------------------------
  const result = await runtime.runGoal(adapter, wsId,
    'Prepare and send a proposal to Stop Corp', { title: 'Stop proposal' });
  check(result && result.plan && result.plan.id, 'runGoal produced a plan');
  equal(result.status, 'waiting_approval', 'plan halts awaiting approval');

  const stopped = await runtime.stopMission(adapter, wsId, result.plan.id);
  equal(stopped.stopped, true, 'stopMission stops an active plan');
  equal(stopped.plan.status, 'cancelled', 'plan is marked cancelled (terminal)');

  // ------------------------------------------------------------------
  // 2. A cancelled plan cannot be resumed — guard is in the run path.
  // ------------------------------------------------------------------
  await throws(
    () => runtime.resume(adapter, wsId, result.plan.id),
    /cannot be resumed|cancelled/,
    'resume throws on a cancelled plan'
  );

  // ------------------------------------------------------------------
  // 3. Stopping an already-terminal plan is a no-op.
  // ------------------------------------------------------------------
  const stoppedAgain = await runtime.stopMission(adapter, wsId, result.plan.id);
  equal(stoppedAgain.stopped, false, 'second stop reports stopped:false');
  equal(stoppedAgain.reason, 'cancelled', 'second stop reports the terminal reason');

  // ------------------------------------------------------------------
  // 4. pause refuses to touch a cancelled plan.
  // ------------------------------------------------------------------
  const pausedCancelled = await runtime.pause(adapter, wsId, result.plan.id);
  equal(pausedCancelled.paused, false, 'pause refuses a cancelled plan');
  equal(pausedCancelled.reason, 'cancelled', 'pause reports the terminal reason');

  // ------------------------------------------------------------------
  // 5. Non-terminal plans remain pausable/resumable (no regression).
  // ------------------------------------------------------------------
  const second = await runtime.runGoal(adapter, wsId,
    'Prepare and send a proposal to Pause Corp', { title: 'Pause memo' });
  const paused = await runtime.pause(adapter, wsId, second.plan.id);
  equal(paused.paused, true, 'an active plan can still be paused');
  equal(paused.plan.status, 'paused', 'paused plan status is paused');

  const resumedPlan = await runtime.resume(adapter, wsId, second.plan.id);
  check(resumedPlan && (resumedPlan.status === 'waiting_approval' || resumedPlan.status === 'running' || resumedPlan.status === 'completed'),
    'a merely paused plan can still be resumed');

  console.log(`\n✓ tests/test-mission-stop.js — ${n} assertions passed`);
  process.exit(0);
})().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
