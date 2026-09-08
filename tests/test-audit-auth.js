// tests/test-audit-auth.js
// Scoped audit-key authentication (services/auditAuth.js): the legacy
// AUDIT_API_KEY acts as a root key, and AUDIT_API_KEYS splits surfaces into
// independently-credentialed scopes. Fail-closed and constant-time.

const assert = require('assert');
const {
  AUDIT_SCOPES,
  auditKeyEquals,
  parseAuditKeyMap,
  auditConfigured,
  grantedAuditScopes,
  requireAuditAuth
} = require('../services/auditAuth');

let n = 0;
function check(cond, msg) { assert.ok(cond, msg); n += 1; }

function env(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function mkReq(key) {
  return {
    headers: { 'x-api-key': key || '' },
    get(name) { return this.headers[String(name).toLowerCase()] || undefined; }
  };
}

function mkRes() {
  return {
    statusCode: 0,
    body: null,
    calledNext: false,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

(async () => {
  // ------------------------------------------------------------------ helpers
  check(auditKeyEquals('abc', 'abc'), 'equal keys match');
  check(!auditKeyEquals('abc', 'abd'), 'differing keys do not match');
  check(!auditKeyEquals('abc', 'abcd'), 'length mismatch never matches (constant-time)');
  check(!auditKeyEquals('', 'abc'), 'empty provided key rejected');
  check(!auditKeyEquals(null, 'abc'), 'null provided key rejected');
  check(!auditKeyEquals('abc', null), 'null candidate rejected');
  check(!auditKeyEquals('abc', 123), 'non-string candidate rejected');

  // ------------------------------------------------------------------ parse
  env('AUDIT_API_KEYS', JSON.stringify({ root: 'R', audit: 'A' }));
  const map = parseAuditKeyMap();
  check(map.root === 'R' && map.audit === 'A', 'AUDIT_API_KEYS parses to a scope map');
  env('AUDIT_API_KEYS', '{not json');
  check(typeof parseAuditKeyMap() === 'object', 'invalid JSON → empty map (fail-closed)');
  env('AUDIT_API_KEYS', undefined);

  const emptyMap = {};
  check(!auditConfigured('', emptyMap), 'nothing configured → not configured (503 path)');
  check(auditConfigured('SOMEKEY', emptyMap), 'legacy AUDIT_API_KEY alone configures the service');
  check(auditConfigured('', { revenue: 'RV' }), 'a single scoped key configures the service');

  // ------------------------------------------------------------------ scopes
  const legacy = 'legacy_root_secret';
  check(grantedAuditScopes(legacy, legacy, emptyMap).size === AUDIT_SCOPES.length,
    'legacy root key grants every scope');
  const scoped = grantedAuditScopes('ONLY_AUDIT', '', { audit: 'ONLY_AUDIT' });
  check(scoped.has('audit'), 'scoped key grants its own surface');
  check(!scoped.has('revenue') && !scoped.has('root'), 'scoped key does NOT grant other surfaces');
  const multi = { audit: 'A1', outreach: 'O1' };
  check(grantedAuditScopes('O1', '', multi).has('outreach'), 'key maps to outreach scope');
  check(!grantedAuditScopes('O1', '', multi).has('audit'), 'outreach key cannot read the audit vault');
  check(grantedAuditScopes('MASTER', '', { root: 'MASTER' }).size === AUDIT_SCOPES.length,
    'root entry in the JSON map grants every scope');

  // ------------------------------------------------------------------ middleware (fail-closed, never leaks)
  const middleware = requireAuditAuth('audit');

  env('AUDIT_API_KEY', '');
  env('AUDIT_API_KEYS', undefined);
  let res = mkRes();
  await middleware(mkReq('whatever'), res, () => { res.calledNext = true; });
  check(res.statusCode === 503 && res.body.error === 'audit_endpoint_not_configured',
    'no key material → 503 audit_endpoint_not_configured');

  env('AUDIT_API_KEY', legacy);
  res = mkRes();
  await middleware(mkReq('wrong'), res, () => { res.calledNext = true; });
  check(res.statusCode === 401 && !res.calledNext, 'wrong key → 401 unauthorized');
  check(!String(res.body.error).includes('wrong'), '401 body does not echo the presented key');
  check(!String(res.body).includes(legacy), '401 body does not leak the real key');

  res = mkRes();
  await middleware(mkReq(''), res, () => { res.calledNext = true; });
  check(res.statusCode === 401, 'missing key → 401');

  res = mkRes();
  await middleware(mkReq(legacy), res, () => { res.calledNext = true; });
  check(res.calledNext, 'legacy root key passes an audited surface');

  // Scoped: revenue key cannot pass an audit surface, can pass revenue.
  env('AUDIT_API_KEY', undefined);
  env('AUDIT_API_KEYS', JSON.stringify({ revenue: 'RV_KEY', audit: 'AUD_KEY' }));
  res = mkRes();
  await middleware(mkReq('RV_KEY'), res, () => { res.calledNext = true; });
  check(res.statusCode === 401 && res.body.required_scope === 'audit',
    'revenue-scoped key rejected on /api/audit with required scope named');
  const revenueMw = requireAuditAuth('revenue');
  res = mkRes();
  await revenueMw(mkReq('RV_KEY'), res, () => { res.calledNext = true; });
  check(res.calledNext, 'revenue-scoped key passes revenue surfaces');
  res = mkRes();
  await revenueMw(mkReq('AUD_KEY'), res, () => { res.calledNext = true; });
  check(res.statusCode === 401, 'audit-scoped key rejected on revenue surfaces');

  // Root entries in the JSON map still pass every scope.
  env('AUDIT_API_KEYS', JSON.stringify({ root: 'MASTER2' }));
  res = mkRes();
  await middleware(mkReq('MASTER2'), res, () => { res.calledNext = true; });
  check(res.calledNext, 'JSON root key passes audited surface');

  env('AUDIT_API_KEY', undefined);
  env('AUDIT_API_KEYS', undefined);

  console.log(`\n✓ scoped audit-key authentication (${n} assertions passed)`);
  process.exit(0);
})().catch((err) => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
