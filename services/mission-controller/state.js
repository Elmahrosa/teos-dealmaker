const { MISSION_LIFECYCLE } = require('./schema');

const TRANSITIONS = {
  proposed: ['planned', 'cancelled'],
  planned: ['running', 'cancelled'],
  running: ['waiting_approval', 'paused', 'completed', 'failed', 'budget_exceeded', 'cancelled'],
  waiting_approval: ['running', 'paused', 'cancelled'],
  paused: ['running', 'cancelled'],
  completed: [],
  failed: [],
  budget_exceeded: [],
  cancelled: []
};

function canTransition(from, to) {
  return MISSION_LIFECYCLE.includes(from) &&
    MISSION_LIFECYCLE.includes(to) &&
    (TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal mission transition: ${from} -> ${to}`);
  }
  return true;
}

const registry = new Map();
const listeners = new Set();

function begin(planId, { status = 'proposed', mission = null } = {}) {
  const record = {
    planId,
    status,
    mission,
    transitions: [],
    updatedAt: new Date().toISOString()
  };
  registry.set(planId, record);
  return record;
}

function transition(planId, to, meta) {
  const record = registry.get(planId);
  if (!record) throw new Error(`Unknown mission ${planId} in state registry`);
  assertTransition(record.status, to);
  record.transitions.push({
    from: record.status,
    to,
    at: new Date().toISOString(),
    meta: meta || null
  });
  record.status = to;
  record.updatedAt = new Date().toISOString();
  const last = record.transitions[record.transitions.length - 1];
  for (const fn of listeners) fn({ planId, from: last.from, to, meta: last.meta });
  return record;
}

function onTransition(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function snapshot(planId) {
  const record = registry.get(planId);
  return record ? { ...record, transitions: [...record.transitions] } : null;
}

function status(planId) {
  const record = registry.get(planId);
  return record ? record.status : null;
}

function list() {
  return [...registry.values()].map(r => ({ planId: r.planId, status: r.status }));
}

function reset() {
  registry.clear();
}

module.exports = {
  MISSION_LIFECYCLE,
  TRANSITIONS,
  canTransition,
  assertTransition,
  begin,
  transition,
  onTransition,
  snapshot,
  status,
  list,
  reset
};
