const EVENT_NAMES = {
  PLAN_CREATED: 'PLAN_CREATED',
  PLAN_STARTED: 'PLAN_STARTED',
  PLAN_COMPLETED: 'PLAN_COMPLETED',
  PLAN_FAILED: 'PLAN_FAILED',
  TASK_STARTED: 'TASK_STARTED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_FAILED: 'TASK_FAILED',
  TASK_RETRYING: 'TASK_RETRYING',
  PROVIDER_FAILED: 'PROVIDER_FAILED',
  PROVIDER_FALLBACK: 'PROVIDER_FALLBACK',
  REVIEW_COMPLETED: 'REVIEW_COMPLETED',
  APPROVAL_REQUESTED: 'APPROVAL_REQUESTED',
  APPROVAL_DECIDED: 'APPROVAL_DECIDED',
  CONFIDENCE_LOW: 'CONFIDENCE_LOW',
  MEMORY_UPDATED: 'MEMORY_UPDATED',
  BRIEFING_READY: 'BRIEFING_READY'
};

const listeners = new Map();

function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => {
    const set = listeners.get(event);
    if (set) set.delete(fn);
  };
}

function emit(event, payload) {
  const set = listeners.get(event);
  if (!set || !set.size) return;
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch (_) {
      /* listener errors never break the runtime */
    }
  }
}

function clear() {
  listeners.clear();
}

module.exports = { EVENT_NAMES, on, emit, clear };
