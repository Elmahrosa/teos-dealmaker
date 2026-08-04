// services/plugin-manager/lifecycle.js
// Plugin lifecycle states and transitions.
//
//   loaded ──► initialize() ──► healthy
//                    │                │
//                    ▼                ▼
//                 degraded        disabled ◄── disable(id)
//                                     │
//                                     ▼ enable(id)
//                                 healthy / degraded
//
// A disabled plugin is never executed: its transport adapter is swapped for a
// denial adapter that returns plugin_disabled before any external I/O. A
// plugin that fails validation or load never enters the registry (reported as
// failed by the loader instead).
'use strict';

const STATES = {
  LOADED: 'loaded',
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  DISABLED: 'disabled',
  FAILED: 'failed'
};

function disabledAdapter(pluginId) {
  return {
    config: () => ({ endpoint: 'disabled://' }),
    call: async () => ({ ok: false, error: 'plugin_disabled', plugin: pluginId }),
    health: async () => ({ ok: true, status: 'disabled' }),
    discover: async () => ({ ok: true, tools: [] })
  };
}

function initialize(record) {
  if (typeof record.onInitialize === 'function') {
    let result;
    try {
      result = record.onInitialize();
    } catch (err) {
      record.state = STATES.DEGRADED;
      record.lastError = err.message;
      return record.state;
    }
    const apply = (value) => {
      record.state = value && value.ok === false ? STATES.DEGRADED : STATES.HEALTHY;
    };
    if (result && typeof result.then === 'function') {
      result.then(apply).catch((err) => {
        record.state = STATES.DEGRADED;
        record.lastError = err.message;
      });
    } else {
      apply(result);
    }
  } else {
    record.state = STATES.HEALTHY;
  }
  return record.state;
}

async function healthCheck(record) {
  if (!record) return { ok: false, status: 'unknown' };
  if (record.state === STATES.DISABLED) return { ok: true, status: 'disabled' };
  if (record.state === STATES.FAILED) return { ok: false, status: 'failed' };
  if (typeof record.onHealth === 'function') {
    try {
      const result = await record.onHealth();
      const ok = Boolean(result && result.status === 'ok');
      record.state = ok ? STATES.HEALTHY : STATES.DEGRADED;
      return { ok, status: record.state, detail: result || null };
    } catch (err) {
      record.state = STATES.DEGRADED;
      return { ok: false, status: 'degraded', error: err.message };
    }
  }
  record.state = STATES.HEALTHY;
  return { ok: true, status: 'healthy' };
}

function enable(record) {
  if (!record) return { ok: false, reason: 'unknown_plugin' };
  if (record.state === STATES.DISABLED) {
    record.state = record.lastState || STATES.HEALTHY;
  }
  return { ok: true, id: record.id, enabled: record.state !== STATES.DISABLED };
}

function disable(record) {
  if (!record) return { ok: false, reason: 'unknown_plugin' };
  if (record.state !== STATES.DISABLED) {
    record.lastState = record.state;
    record.state = STATES.DISABLED;
  }
  return { ok: true, id: record.id, enabled: false };
}

async function shutdown(record) {
  if (!record) return { ok: false, reason: 'unknown_plugin' };
  if (typeof record.onShutdown === 'function') {
    try {
      await record.onShutdown();
    } catch (_) {
      /* shutdown must never throw into the platform */
    }
  }
  return { ok: true, id: record.id };
}

module.exports = { STATES, disabledAdapter, initialize, healthCheck, enable, disable, shutdown };
