'use strict';

// Scoped audit-key authentication for gated surfaces.
//
// Two env forms, both optional:
//   AUDIT_API_KEY    legacy root key — grants every scope.
//   AUDIT_API_KEYS   JSON map scope -> key for separate per-surface keys:
//      {"root":"<master>","founder_console":"...","ops":"...",
//       "audit":"...","outreach":"...","revenue":"..."}
//
// Fail-closed: no key material configured -> 503; unknown/missing/insufficient
// key -> 401. Comparisons are constant-time (no length/timing leaks).

const crypto = require('crypto');

const AUDIT_SCOPES = ['founder_console', 'ops', 'audit', 'outreach', 'revenue'];

function auditKeyEquals(provided, candidate) {
  if (!provided || !candidate || typeof provided !== 'string' || typeof candidate !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(candidate);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseAuditKeyMap() {
  try {
    const map = JSON.parse(process.env.AUDIT_API_KEYS || '{}');
    return map && typeof map === 'object' ? map : {};
  } catch (_err) {
    console.error('[config] AUDIT_API_KEYS is not valid JSON; ignoring it');
    return {};
  }
}

function auditConfigured(legacy, map) {
  return Boolean(legacy) ||
    (typeof map.root === 'string' && Boolean(map.root)) ||
    AUDIT_SCOPES.some((s) => typeof map[s] === 'string' && Boolean(map[s]));
}

function grantedAuditScopes(provided, legacy, map) {
  const granted = new Set();
  if (auditKeyEquals(provided, legacy) || auditKeyEquals(provided, map.root)) {
    AUDIT_SCOPES.forEach((s) => granted.add(s));
    return granted;
  }
  for (const s of AUDIT_SCOPES) {
    if (auditKeyEquals(provided, map[s])) granted.add(s);
  }
  return granted;
}

function requireAuditAuth(scope) {
  const required = scope || 'root';
  return function auditAuthMiddleware(req, res, next) {
    const legacy = process.env.AUDIT_API_KEY;
    const map = parseAuditKeyMap();
    if (!auditConfigured(legacy, map)) {
      return res.status(503).json({ error: 'audit_endpoint_not_configured' });
    }
    const provided = req.get('x-api-key') || '';
    if (!grantedAuditScopes(provided, legacy, map).has(required)) {
      return res.status(401).json({ error: 'unauthorized', required_scope: required });
    }
    next();
  };
}

module.exports = {
  AUDIT_SCOPES,
  auditKeyEquals,
  parseAuditKeyMap,
  auditConfigured,
  grantedAuditScopes,
  requireAuditAuth
};
