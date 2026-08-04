// services/platform/policies/registry.js
// Policy rule registry. Rules are named, scoped, prioritized, and independently
// enable/disable-able. A rule is a function (request) -> decision | null; null
// means "not applicable", an { allowed: false } object means deny (fail-closed).
'use strict';

function createRuleRegistry() {
  const rules = new Map();

  function register({ id, name, scope, priority, fn }) {
    if (!id || typeof fn !== 'function') {
      return { ok: false, reason: 'rule_requires_id_and_fn' };
    }
    rules.set(id, {
      id,
      name: name || id,
      scope: scope || '*',
      priority: Number.isInteger(priority) ? priority : 100,
      enabled: true,
      fn
    });
    return { ok: true, id };
  }

  function unregister(id) {
    const removed = rules.delete(id);
    return { ok: removed, id };
  }

  function enable(id) {
    const rule = rules.get(id);
    if (!rule) return { ok: false, reason: 'unknown_rule' };
    rule.enabled = true;
    return { ok: true, id, enabled: true };
  }

  function disable(id) {
    const rule = rules.get(id);
    if (!rule) return { ok: false, reason: 'unknown_rule' };
    rule.enabled = false;
    return { ok: true, id, enabled: false };
  }

  function get(id) {
    const rule = rules.get(id);
    if (!rule) return null;
    return { id: rule.id, name: rule.name, scope: rule.scope, priority: rule.priority, enabled: rule.enabled };
  }

  function list() {
    return Array.from(rules.values())
      .map((r) => ({ id: r.id, name: r.name, scope: r.scope, priority: r.priority, enabled: r.enabled }))
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  function ordered() {
    return Array.from(rules.values())
      .filter((r) => r.enabled)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  return { register, unregister, enable, disable, get, list, ordered };
}

module.exports = { createRuleRegistry };
