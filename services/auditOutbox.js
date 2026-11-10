'use strict';
// Transactional audit outbox. Lifecycle events (currently DEAL_WON) are written
// to audit_outbox inside the same transaction as the state change. This module
// delivers them to the authoritative hash-chained vault.
//
// Guarantees:
//  - event_id (UUID) is the idempotency key, stored in the vault entry's
//    details.eventId. Delivery first looks the id up in the vault, so retries,
//    duplicate attempts and repeated reconciliation never add a second entry.
//  - A row is marked 'delivered' only after the vault write AND a successful
//    verifyVault() that also finds the entry. Otherwise the failure is recorded
//    (attempts, last_error) and the row stays pending (or 'failed' after
//    MAX_ATTEMPTS). Rows are never deleted or silently skipped.
//  - A broken vault chain blocks delivery: nothing is appended to a vault that
//    already fails verification.

const crypto = require('crypto');

const MAX_ATTEMPTS = 5;

function audit() { return require('../utils/auditLogger'); }

function newEventId() { return crypto.randomUUID(); }

// Row to insert inside the caller's transaction.
function buildEvent({ workspace_id = null, deal_id = null, action, target, status, details = {} }) {
  return {
    event_id: newEventId(),
    workspace_id, deal_id, action,
    target: target === undefined || target === null ? null : String(target),
    status: status || null,
    details,
    state: 'pending',
    attempts: 0
  };
}

function deliverOnce(row) {
  const a = audit();
  const before = a.verifyVault();
  if (!before.valid) {
    const e = new Error(`vault_chain_invalid_before_delivery (first bad entry ${before.firstBad})`);
    e.code = 'VAULT_CHAIN_INVALID';
    throw e;
  }
  if (!a.findByEventId(row.event_id)) {
    const details = { ...(row.details || {}), eventId: row.event_id };
    a.writeEntry(row.action, row.target, row.status, details, { mirror: false });
  }
  const after = a.verifyVault();
  if (!after.valid) {
    const e = new Error(`vault_chain_invalid_after_delivery (first bad entry ${after.firstBad})`);
    e.code = 'VAULT_CHAIN_INVALID';
    throw e;
  }
  const confirmed = a.findByEventId(row.event_id);
  if (!confirmed || !confirmed.hash) {
    const e = new Error('vault_entry_not_found_after_write');
    e.code = 'VAULT_ENTRY_MISSING';
    throw e;
  }
  return confirmed;
}

// One global lock for the whole vault: the hash chain is a single sequence, so
// two processes appending DIFFERENT events at once would fork it too. The lock
// covers re-reading the row, event lookup, vault append, chain verification and
// the delivered-state update.
const VAULT_LOCK = 'teos:audit_vault_delivery';
const LOCK_WAIT_MS = 5000;

async function recordLockProblem(adapter, row, message) {
  console.error(`[auditOutbox] event ${row.event_id} left pending: ${message}`);
  try {
    await adapter.update('audit_outbox', { id: row.id }, { last_error: message });
  } catch (_e) { /* the row is untouched and still pending */ }
}

// Deliver one outbox row. Never throws; returns { ok, state, error?, hash? }.
async function deliverEvent(adapter, row, opts = {}) {
  if (!row) return { ok: false, state: 'missing', error: 'outbox_row_not_found' };
  if (row.state === 'delivered') return { ok: true, state: 'delivered', hash: row.vault_hash, duplicate: true };
  if (typeof adapter.withAdvisoryLock !== 'function') {
    await recordLockProblem(adapter, row, 'vault_lock_unsupported_by_adapter');
    return { ok: false, state: row.state, error: 'vault_lock_unsupported_by_adapter', code: 'LOCK_UNAVAILABLE' };
  }
  let locked;
  try {
    locked = await adapter.withAdvisoryLock(VAULT_LOCK, async () => {
      // Re-read under the lock: another process may have delivered it meanwhile.
      const fresh = await adapter.findOne('audit_outbox', { id: row.id });
      if (!fresh) return { ok: false, state: 'missing', error: 'outbox_row_not_found' };
      if (fresh.state === 'delivered') return { ok: true, state: 'delivered', hash: fresh.vault_hash, duplicate: true };
      try {
        const entry = deliverOnce(fresh);
        await adapter.update('audit_outbox', { id: fresh.id }, {
          state: 'delivered', vault_hash: entry.hash, delivered_at: new Date().toISOString(),
          attempts: (fresh.attempts || 0) + 1, last_error: null
        });
        return { ok: true, state: 'delivered', hash: entry.hash };
      } catch (err) {
        const attempts = (fresh.attempts || 0) + 1;
        const state = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
        console.error(`[auditOutbox] delivery failed for event ${fresh.event_id} (attempt ${attempts}): ${err.message}`);
        try {
          await adapter.update('audit_outbox', { id: fresh.id }, { state, attempts, last_error: String(err.message).slice(0, 500) });
        } catch (e2) {
          console.error('[auditOutbox] could not record delivery failure:', e2.message);
        }
        return { ok: false, state, error: err.message, code: err.code };
      }
    }, { timeoutMs: opts.lockWaitMs === undefined ? LOCK_WAIT_MS : opts.lockWaitMs });
  } catch (err) {
    // Lock infrastructure failed (e.g. connection lost): nothing was appended
    // outside the lock; the event stays recoverable.
    await recordLockProblem(adapter, row, `vault_lock_error: ${err.message}`);
    return { ok: false, state: row.state, error: `vault_lock_error: ${err.message}`, code: 'LOCK_ERROR' };
  }
  if (!locked.acquired) {
    await recordLockProblem(adapter, row, 'vault_lock_busy');
    return { ok: false, state: row.state, error: 'vault_lock_busy', code: 'LOCK_BUSY' };
  }
  return locked.value;
}

async function deliverByEventId(adapter, eventId) {
  const row = await adapter.findOne('audit_outbox', { event_id: eventId });
  return deliverEvent(adapter, row);
}

// Explicit reconciliation: process every pending or failed row, oldest first.
async function reconcile(adapter, opts = {}) {
  const limit = opts.limit || 500;
  const rows = [
    ...(await adapter.find('audit_outbox', { state: 'pending' }, { orderBy: 'id', order: 'asc', limit })),
    ...(await adapter.find('audit_outbox', { state: 'failed' }, { orderBy: 'id', order: 'asc', limit }))
  ].sort((x, y) => x.id - y.id);
  const result = { processed: 0, delivered: 0, failed: 0 };
  for (const row of rows) {
    result.processed += 1;
    const r = await deliverEvent(adapter, row);
    if (r.ok) result.delivered += 1; else result.failed += 1;
  }
  result.counts = await counts(adapter);
  return result;
}

async function counts(adapter) {
  const c = { pending: 0, failed: 0, delivered: 0 };
  for (const state of Object.keys(c)) {
    c[state] = (await adapter.find('audit_outbox', { state })).length;
  }
  return c;
}

// ---- Operational visibility -------------------------------------------------
const ALERT_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const alertState = { lastAt: 0, lastFailed: 0 };

// Founder alert for failed outbox events. Always logged loudly; the notifier
// (Slack/email, inert when unconfigured) is throttled: sent when the failed count
// rises or every ALERT_MIN_INTERVAL_MS while it stays non-zero, never per retry.
// State is per process (a restart may re-alert once).
async function alertIfFailed(counters, opts = {}) {
  const now = opts.now === undefined ? Date.now() : opts.now;
  if (!counters.failed) { alertState.lastAt = 0; alertState.lastFailed = 0; return { alerted: false }; }
  console.error(`[auditOutbox] ALERT: ${counters.failed} audit event(s) FAILED delivery to the vault (${counters.pending} pending). Repair the vault chain, then POST /api/audit-outbox/reconcile.`);
  const rising = counters.failed > alertState.lastFailed;
  const due = now - alertState.lastAt >= (opts.minIntervalMs === undefined ? ALERT_MIN_INTERVAL_MS : opts.minIntervalMs);
  if (!rising && !due) return { alerted: false, throttled: true };
  alertState.lastAt = now; alertState.lastFailed = counters.failed;
  try {
    const notifier = opts.notifier || require('./notify').createNotifier();
    await notifier.notify('TEOS audit outbox: failed vault deliveries', `${counters.failed} failed, ${counters.pending} pending. Lifecycle events are committed in the database but not in the audit vault. Check GET /api/audit-outbox and repair the vault chain.`);
  } catch (err) {
    console.error('[auditOutbox] founder alert could not be sent:', err.message);
  }
  return { alerted: true };
}

let running = false;
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ error: 'reconcile_timeout' }), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// One bounded, non-overlapping cycle: reconcile, then alert. Never throws.
async function runCycle(adapter, opts = {}) {
  if (running) return { skipped: 'already_running' };
  running = true;
  try {
    const r = await withTimeout((async () => {
      const rec = await reconcile(adapter);
      await alertIfFailed(rec.counts, opts);
      return rec;
    })(), opts.timeoutMs || 30000);
    if (r.error) console.error('[auditOutbox] reconcile cycle did not finish:', r.error);
    return r;
  } catch (err) {
    console.error('[auditOutbox] reconcile cycle failed:', err.message);
    return { error: err.message };
  } finally {
    running = false;
  }
}

// Startup hook: fire-and-forget from the caller, bounded by a timeout, and safe to
// repeat (delivery is idempotent). Never blocks boot.
async function reconcileOnStartup(adapter, opts) {
  const r = await runCycle(adapter, opts);
  if (r && r.processed) console.log(`[auditOutbox] startup reconcile: ${JSON.stringify({ processed: r.processed, delivered: r.delivered, failed: r.failed })}`);
  return r;
}

// Periodic retry so a transient vault problem heals without an operator. Started
// only by the web service. Disabled with OUTBOX_RECONCILE_INTERVAL_MS=0.
function startPeriodic(getAdapter, opts = {}) {
  const ms = opts.intervalMs !== undefined ? opts.intervalMs : Number(process.env.OUTBOX_RECONCILE_INTERVAL_MS || 300000);
  if (!ms) return null;
  const timer = setInterval(() => { try { runCycle(getAdapter(), opts); } catch (err) { console.error('[auditOutbox] periodic cycle error:', err.message); } }, ms);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { MAX_ATTEMPTS, VAULT_LOCK, alertIfFailed, runCycle, startPeriodic, buildEvent, deliverEvent, deliverByEventId, reconcile, reconcileOnStartup, counts };
