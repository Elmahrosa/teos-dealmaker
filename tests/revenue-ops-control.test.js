// tests/revenue-ops-control.test.js
// Founder control layer: the LIVE GUARD plus pause / resume / emergency-stop.
// Fail-closed assertions: nothing processes unless the founder has explicitly
// enabled AND armed the system; emergency stop survives restart and blocks even
// manual triggers until the founder clears it. In-memory adapter, no DB needed.
'use strict';

const assert = require('assert');
const dbMod = require('../db');

const ENV_EMERGENCY = 'SOR_EMERGENCY_STOP';

process.env.SOR_ENABLED = 'true';

async function main() {
  console.log('🛡️ Revenue Ops Control (live guard) Test\n');

  const adapter = dbMod.createMemoryAdapter();
  const db = { adapter, pg: null, repos: dbMod.createRepos(adapter) };
  const r = db.repos;
  const revenueOps = require('../services/revenueOps');

  // ---- 1. fail closed by default: no mode row means PAUSED (never armed) ----
  let g = await revenueOps._control.live(db);
  assert.strictEqual(g.ok, false, 'default state must be fail-closed');
  assert.strictEqual(g.reason, 'paused', 'default guard reason must be paused (not armed)');
  let t = await revenueOps._scheduler.tick(db, {});
  assert.strictEqual(t.ok, false, 'automatic tick must be denied when not armed');
  assert.strictEqual(t.reason, 'paused', 'automatic tick reason');

  // ---- 2. resume arms the system ----
  let res = await revenueOps.resume(adapter, 'founder-test', 'approve batch 1');
  assert.strictEqual(res.ok, true, 'resume must succeed');
  assert.strictEqual(res.state, 'RUNNING', 'resume must set RUNNING');
  g = await revenueOps._control.live(db);
  assert.strictEqual(g.ok, true, 'live guard must pass once RUNNING');
  assert.strictEqual(g.mode, 'RUNNING', 'guard mode RUNNING');
  t = await revenueOps._scheduler.tick(db, {});
  assert.strictEqual(t.ok, true, 'automatic tick allowed when RUNNING');

  // ---- 3. pause soft-stops ----
  res = await revenueOps.pause(adapter, 'founder-test', 'quiet hours');
  assert.strictEqual(res.ok, true, 'pause must succeed');
  assert.strictEqual(res.state, 'PAUSED', 'pause must set PAUSED');
  g = await revenueOps._control.live(db);
  assert.strictEqual(g.ok, false, 'live guard must deny while paused');
  assert.strictEqual(g.reason, 'paused', 'guard reason paused');
  t = await revenueOps._scheduler.tick(db, {});
  assert.strictEqual(t.ok, false, 'automatic tick denied while paused');

  // ---- 4. emergency stop: hard kill, blocks even manual force ----
  res = await revenueOps.emergencyStop(adapter, 'founder-test', 'regulatory hold');
  assert.strictEqual(res.ok, true, 'emergency stop must succeed');
  assert.strictEqual(res.state, 'EMERGENCY_STOPPED', 'emergency stop sets EMERGENCY_STOPPED');
  assert.strictEqual(process.env[ENV_EMERGENCY], 'true', 'env emergency flag set');
  g = await revenueOps._control.live(db);
  assert.strictEqual(g.ok, false, 'live guard denied after emergency stop');
  assert.strictEqual(g.reason, 'emergency_stop_env', 'guard reason emergency_stop_env');
  t = await revenueOps._scheduler.tick(db, { force: true });
  assert.strictEqual(t.ok, false, 'manual forced tick denied while emergency-stopped');
  assert.strictEqual(t.reason, 'emergency_stop_env', 'forced tick reason');
  const emerg = await db.adapter.findOne('revenue_ops_state', { key: 'sor_emergency' });
  assert.ok(emerg && emerg.payload, 'emergency stop persisted with payload');
  assert.strictEqual(emerg.payload.reason, 'regulatory hold', 'emergency reason persisted');

  // ---- 5. resume refused while emergency flag active ----
  res = await revenueOps.resume(adapter, 'founder-test', null);
  assert.strictEqual(res.ok, false, 'resume must be refused while emergency flag is set');
  assert.strictEqual(res.error, 'emergency_stop_env_active', 'resume error code');
  const modeAfterBlockedResume = await r.revenueOps.get('sor_mode');
  assert.strictEqual(modeAfterBlockedResume.value, 'EMERGENCY_STOPPED', 'mode must remain EMERGENCY_STOPPED');

  // ---- 6. emergency survives a restart: start() must not auto-rearm ----
  const started = await revenueOps.start(adapter);
  assert.strictEqual(started.ok, true, 'clock can start but stays gated');
  const modeAfterRestart = await r.revenueOps.get('sor_mode');
  assert.strictEqual(modeAfterRestart.value, 'EMERGENCY_STOPPED', 'start() must not override emergency stop');
  t = await revenueOps._scheduler.tick(db, {});
  assert.strictEqual(t.ok, false, 'automatic tick still denied after restart');

  // ---- 7. restart simulation: env cleared but persisted state remains => resume still refused ----
  delete process.env[ENV_EMERGENCY];
  const persistedMode = (await r.revenueOps.get('sor_mode')).value;
  assert.strictEqual(persistedMode, 'EMERGENCY_STOPPED', 'persisted mode must still be EMERGENCY_STOPPED after restart');
  const restartEmergencyRow = await db.adapter.findOne('revenue_ops_state', { key: 'sor_emergency' });
  assert.strictEqual(restartEmergencyRow.value, 'true', 'sor_emergency row must still be set after restart');
  res = await revenueOps.resume(adapter, 'founder-test', 'cleared hold');
  assert.strictEqual(res.ok, false, 'resume must refuse after restart — persisted emergency, no acknowledgment');
  assert.strictEqual(res.error, 'emergency_stopped', 'resume error code for persisted emergency');
  assert.strictEqual((await r.revenueOps.get('sor_mode')).value, 'EMERGENCY_STOPPED', 'mode must remain EMERGENCY_STOPPED after refused resume');

  // ---- 8. deliberate acknowledgment clears the persisted emergency and re-arms ----
  res = await revenueOps.resume(adapter, 'founder-test', 'cleared hold', { acknowledgeEmergency: true });
  assert.strictEqual(res.ok, true, 'resume with explicit acknowledgment must succeed');
  assert.strictEqual(res.state, 'RUNNING', 'mode RUNNING again');
  assert.strictEqual(res.acknowledged, true, 'resume must report acknowledged clear');
  const emergRow = await db.adapter.findOne('revenue_ops_state', { key: 'sor_emergency' });
  assert.strictEqual(emergRow.value, null, 'emergency record cleared on acknowledged resume');
  g = await revenueOps._control.live(db);
  assert.strictEqual(g.ok, true, 'live guard passes after acknowledged resume');

  // ---- 9. audit evidence emitted for each control action, in the SAME chain ----
  const audits = await r.audit.list(null, {});
  const types = audits.map(a => a.action_type);
  for (const expected of ['REVENUE_OPS_RESUMED', 'REVENUE_OPS_PAUSED', 'REVENUE_OPS_EMERGENCY_STOP', 'REVENUE_OPS_EMERGENCY_CLEARED']) {
    assert.ok(types.includes(expected), `audit entry ${expected} present`);
  }
  const emergencyAudit = audits.find(a => a.action_type === 'REVENUE_OPS_EMERGENCY_STOP');
  assert.ok(emergencyAudit && emergencyAudit.timestamp, 'emergency stop audit entry must carry a timestamp');
  assert.strictEqual(emergencyAudit.details.reason, 'regulatory hold', 'emergency reason in the audit chain');
  assert.strictEqual(emergencyAudit.details.by, 'founder-test', 'emergency actor in the audit chain');
  const modeAudits = audits.filter(a => a.action_type === 'REVENUE_OPS_MODE' && a.details && a.details.mode === 'EMERGENCY_STOPPED');
  assert.ok(modeAudits.length >= 1 && modeAudits[0].timestamp, 'mode-change audit entry also timestamped');

  // ---- 10. disabled feature => fail closed regardless of mode ----
  process.env.SOR_ENABLED = 'false';
  g = await revenueOps._control.live(db);
  assert.strictEqual(g.ok, false, 'disabled => guard denies');
  assert.strictEqual(g.reason, 'sor_disabled', 'disabled reason');
  process.env.SOR_ENABLED = 'true';

  await revenueOps.stop();
  console.log('✅ Live guard, pause, resume, emergency-stop — all passing');
}

main().catch(err => {
  console.error('❌ Revenue Ops Control test failed:', err && err.message ? err.message : err);
  process.exit(1);
});
