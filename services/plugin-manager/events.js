// services/plugin-manager/events.js
// Loosely-coupled event bus. Plugins subscribe through the scoped plugin API;
// core layers emit domain events (mission.started, workspace.created, ...).
// Nothing is required to listen and no emitter depends on a subscriber.
'use strict';

const EVENT_NAMES = [
  'mission.started',
  'mission.finished',
  'mission.failed',
  'workspace.created',
  'workspace.deleted',
  'lead.created',
  'payment.completed',
  'payment.failed',
  'capability.executed',
  'sentinel.scan.completed'
];

function createBus() {
  const handlers = new Map();

  function subscribe(name, handler) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('event name is required');
    if (typeof handler !== 'function') throw new Error('event handler must be a function');
    const set = handlers.get(name) || new Set();
    set.add(handler);
    handlers.set(name, set);
    return () => {
      set.delete(handler);
      if (set.size === 0) handlers.delete(name);
    };
  }

  function once(name, handler) {
    let off = null;
    off = subscribe(name, (payload) => {
      off();
      handler(payload);
    });
  }

  function emit(name, payload) {
    const set = handlers.get(name);
    if (!set) return [];
    const results = [];
    for (const handler of set) {
      try {
        results.push(handler(payload));
      } catch (err) {
        results.push({ error: err.message });
      }
    }
    return results;
  }

  function names() {
    return Array.from(handlers.keys()).sort();
  }

  return { subscribe, once, emit, names };
}

module.exports = { createBus, EVENT_NAMES };
