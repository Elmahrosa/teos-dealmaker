// services/revenueOps/control.js
// Founder control layer for 24/7 Revenue Operations. The live guard is the
// single fail-closed gate every automatic action must pass: enabled by the
// founder (SOR_ENABLED), not emergency-stopped (env flag or persisted state),
// and explicitly RUNNING. Pause/resume/emergency-stop are founder-only actions
// that write persisted state, emit audit evidence, and (via injected hooks)
// stop or restart the scheduler clock.
'use strict';

const { config, now, getState, setMode, heartbeat, MODES } = require('./core');

const ENV_EMERGENCY_STOP = 'SOR_EMERGENCY_STOP';
const KEY_EMERGENCY = 'sor_emergency';

async function repos(db) {
  return db.repos || require('../../db/repos').createRepos(db.adapter);
}

function envEmergencyActive() {
  const raw = process.env[ENV_EMERGENCY_STOP];
  return raw !== undefined && raw !== '' && String(raw).toLowerCase() === 'true';
}

function createControl(opts) {
  const o = opts || {};
  const hooks = o.hooks || {};

  async function emergencyInfo(db) {
    const r = await repos(db);
    const row = await r.revenueOps.get(KEY_EMERGENCY);
    return row ? (row.payload || null) : null;
  }

  // THE LIVE GUARD — fail closed. Blocks automatic execution unless the
  // founder has explicitly enabled AND armed the system.
  async function live(db) {
    const c = config();
    if (!c.enabled) return { ok: false, reason: 'sor_disabled', mode: null };
    if (envEmergencyActive()) return { ok: false, reason: 'emergency_stop_env', mode: MODES.EMERGENCY_STOPPED };
    const s = await getState(db);
    if (s.mode === MODES.EMERGENCY_STOPPED) return { ok: false, reason: 'emergency_stopped', mode: s.mode };
    if (s.mode === MODES.STOPPED) return { ok: false, reason: 'stopped', mode: s.mode };
    if (s.mode === MODES.PAUSED) return { ok: false, reason: 'paused', mode: s.mode };
    if (s.mode !== MODES.RUNNING) return { ok: false, reason: 'not_running', mode: s.mode || null };
    await heartbeat(db);
    return { ok: true, reason: null, mode: MODES.RUNNING };
  }

  async function pause(db, by, reason) {
    const s = await getState(db);
    const prev = s.mode || MODES.PAUSED;
    await setMode(db, MODES.PAUSED, by || 'founder', reason || 'founder pause');
    await audit(db, 'REVENUE_OPS_PAUSED', 'success', { by: by || 'founder', reason: reason || 'founder pause', prior_state: prev });
    if (hooks.onPause) await hooks.onPause(db);
    return { ok: true, state: MODES.PAUSED, prior_state: prev };
  }

  async function emergencyPersisted(db) {
    const r = await repos(db);
    const row = await r.revenueOps.get(KEY_EMERGENCY);
    return Boolean(row && row.value !== null && row.value !== undefined);
  }

  async function resume(db, by, reason, opts) {
    const o = opts || {};
    const c = config();
    if (!c.enabled) return { ok: false, error: 'sor_disabled', reason: 'SOR_ENABLED must be true before the founder can resume' };
    if (envEmergencyActive()) {
      return { ok: false, error: 'emergency_stop_env_active', reason: `${ENV_EMERGENCY_STOP} is set; clear it before resuming` };
    }
    const s = await getState(db);
    const persistedEmergency = s.mode === MODES.EMERGENCY_STOPPED || await emergencyPersisted(db);
    if (persistedEmergency && !o.acknowledgeEmergency) {
      return { ok: false, error: 'emergency_stopped', reason: 'A persisted emergency stop is active; resume() requires acknowledgeEmergency:true so the founder deliberately clears it' };
    }
    const r = await repos(db);
    const prev = s.mode || MODES.PAUSED;
    if (persistedEmergency) {
      await audit(db, 'REVENUE_OPS_EMERGENCY_CLEARED', 'success', { by: by || 'founder', reason: reason || 'emergency stop cleared', prior_state: prev });
      await r.revenueOps.set(KEY_EMERGENCY, null);
    }
    await setMode(db, MODES.RUNNING, by || 'founder', reason || 'founder resume');
    await audit(db, 'REVENUE_OPS_RESUMED', 'success', { by: by || 'founder', prior_state: prev });
    if (hooks.onResume) await hooks.onResume(db);
    return { ok: true, state: MODES.RUNNING, prior_state: prev, acknowledged: persistedEmergency };
  }

  async function emergencyStop(db, by, reason) {
    const s = await getState(db);
    const prev = s.mode || MODES.PAUSED;
    const r = await repos(db);
    const timestamp = now();
    await r.revenueOps.set(KEY_EMERGENCY, 'true', {
      by: by || 'founder',
      reason: reason || 'emergency stop',
      prior_state: prev,
      at: timestamp
    });
    await setMode(db, MODES.EMERGENCY_STOPPED, by || 'founder', reason || 'emergency stop');
    process.env[ENV_EMERGENCY_STOP] = 'true';
    await audit(db, 'REVENUE_OPS_EMERGENCY_STOP', 'denied', { by: by || 'founder', reason: reason || 'emergency stop', prior_state: prev });
    if (hooks.onEmergencyStop) await hooks.onEmergencyStop(db);
    return { ok: true, state: MODES.EMERGENCY_STOPPED, prior_state: prev, reason: reason || 'emergency stop' };
  }

  async function status(db) {
    const c = config();
    const s = await getState(db);
    const g = await live(db);
    return {
      ok: true,
      enabled: c.enabled,
      mode: s.mode,
      guard: { live: g.ok, reason: g.reason },
      emergency: await emergencyInfo(db),
      lastWindowEnd: s.lastWindowEnd,
      lastReportId: s.lastReportId,
      heartbeat: s.heartbeat,
      intervalHours: c.intervalHours,
      resendConfigured: c.resendConfigured
    };
  }

  return { live, pause, resume, emergencyStop, status };
}

async function audit(db, actionType, outcome, details) {
  const r = await repos(db);
  r.audit.add({
    workspace_id: null,
    agent_name: 'revenue-ops',
    action_type: actionType,
    timestamp: now(),
    details
  });
}

module.exports = { createControl, envEmergencyActive, ENV_EMERGENCY_STOP, KEY_EMERGENCY };
