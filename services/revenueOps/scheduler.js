const { config, now, getState, heartbeat, MODES } = require('./core');
const { windowEndOf, generateAndSend, recordLastWindow } = require('./report');
const { createControl, envEmergencyActive } = require('./control');

async function repos(db) {
  return db.repos || require('../../db/repos').createRepos(db.adapter);
}

async function processWindow(db, windowStartMs, windowEndMs, by) {
  const result = await generateAndSend(db, windowStartMs, windowEndMs);
  const r = await repos(db);
  await recordLastWindow(db, windowEndMs, result.reportId);
  await r.revenueOps.set('sor_current_window_end', null);
  return { windowStart: result.metrics.windowStart, windowEnd: result.metrics.windowEnd, reportId: result.reportId, delivery: result.delivery, by: by || 'system' };
}

async function tick(db, opts) {
  const o = opts || {};
  const c = config();
  if (!c.enabled) return { ok: false, reason: 'sor_disabled' };
  if (envEmergencyActive()) return { ok: false, reason: 'emergency_stop_env', mode: MODES.EMERGENCY_STOPPED };
  const state = await getState(db);
  if (state.mode === MODES.EMERGENCY_STOPPED) return { ok: false, reason: 'emergency_stopped', mode: state.mode };
  if (!o.force) {
    const guard = await createControl().live(db);
    if (!guard.ok) return { ok: false, reason: guard.reason, mode: guard.mode };
  }
  await heartbeat(db);

  const nowMs = Date.now();
  const currentWindowEnd = windowEndOf(nowMs, c.intervalMs);
  const lastWindowMs = state.lastWindowEnd ? new Date(state.lastWindowEnd).getTime() : null;

  if (lastWindowMs !== null && lastWindowMs >= currentWindowEnd) {
    return { ok: true, upToDate: true, currentWindowEnd: new Date(currentWindowEnd).toISOString() };
  }

  const r = await repos(db);
  const claim = await r.revenueOps.get('sor_current_window_end');
  if (claim && claim.value && Number(new Date(claim.value).getTime()) === currentWindowEnd && !o.force) {
    return { ok: true, claimed: true, currentWindowEnd: new Date(currentWindowEnd).toISOString() };
  }

  const baseMs = lastWindowMs !== null ? lastWindowMs : (currentWindowEnd - c.intervalMs);
  const missed = [];
  for (let end = baseMs + c.intervalMs; end <= currentWindowEnd; end += c.intervalMs) {
    missed.push(end);
  }

  const cap = Math.max(1, Number(c.maxBackfillWindows) || 8);
  const skippedCount = missed.length > cap ? missed.length - cap : 0;
  const backfill = skippedCount > 0 ? missed.slice(missed.length - cap) : missed;
  if (skippedCount > 0) {
    const ra = await repos(db);
    ra.audit.add({
      workspace_id: null,
      agent_name: 'revenue-ops',
      action_type: 'REVENUE_OPS_WINDOWS_SKIPPED',
      timestamp: now(),
      details: {
        skipped: skippedCount,
        cap,
        reason: 'backfill cap reached',
        from: new Date(missed[0] - c.intervalMs).toISOString(),
        to: new Date(missed[skippedCount - 1]).toISOString()
      }
    });
  }

  const processed = [];
  for (const end of backfill) {
    const start = end - c.intervalMs;
    const claimCheck = await r.revenueOps.get('sor_current_window_end');
    if (claimCheck && claimCheck.value && Number(new Date(claimCheck.value).getTime()) === end && !o.force) {
      processed.push({ windowEnd: new Date(end).toISOString(), skipped: 'already_claimed' });
      continue;
    }
    await r.revenueOps.set('sor_current_window_end', new Date(end).toISOString(), { claimed_by: o.by || 'system', claimed_at: now() });
    const done = await processWindow(db, start, end, o.by);
    processed.push(done);
  }

  return { ok: true, processed, backfilled: backfill.length, skippedMissedWindows: skippedCount, currentWindowEnd: new Date(currentWindowEnd).toISOString(), upToDate: false };
}

function createScheduler(opts) {
  const o = opts || {};
  const log = o.log || ((...args) => console.log('[revenue-ops]', ...args));
  let timer = null;
  let running = false;

  async function start(db) {
    if (timer) return { ok: true, alreadyRunning: true };
    const c = config();
    if (!c.enabled) return { ok: false, reason: 'sor_disabled' };
    const state = await getState(db);
    if (state.mode === MODES.EMERGENCY_STOPPED || envEmergencyActive()) {
      log('clock started but emergency-stopped; awaiting explicit founder resume');
    }
    running = true;
    tick(db).then(res => {
      if (res && res.ok) log('startup catch-up complete', { processed: res.processed ? res.processed.length : 0, skippedMissedWindows: res.skippedMissedWindows || 0, upToDate: res.upToDate });
      else log('startup catch-up:', res);
    }).catch(err => log('startup catch-up error:', err.message));
    timer = setInterval(() => {
      tick(db).then(res => {
        if (res && res.ok && res.processed) log(`window processed: ${res.processed.length} report(s)`);
        else if (res && res.ok && res.claimed) log('window already claimed by another tick');
      }).catch(err => log('tick error:', err.message));
    }, c.intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return { ok: true, intervalMs: c.intervalMs };
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    running = false;
    return { ok: true };
  }

  return { start, stop, tick, running: () => running };
}

module.exports = { createScheduler, tick, processWindow };
