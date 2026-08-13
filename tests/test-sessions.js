// tests/test-sessions.js
// Server-side session authentication (issue #17).
//
// Regression coverage for the web identity holes that were closed:
//   - login/web-login now issue real server-side sessions (SHA-256 hash at
//     rest) instead of an unvalidated placeholder token
//   - /api/auth/entitlement and /api/auth/missions/increment derive identity
//     from the validated session, never from a spoofable x-user-id header
//   - the Command Center placeholder gate that accepted any ≥32-char
//     x-founder-session header or ?session= query value is replaced by a real
//     founder session check
//   - founder authorization is a single deterministic gate
//     (TEOS_FOUNDER_TELEGRAM_ID), not workspace member roles
'use strict';

const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const identity = require('../services/identity');
const session = require('../services/session');

let passed = 0;
const eq = (actual, expected, msg) => { assert.strictEqual(actual, expected, msg); passed++; };
const tru = (value, msg) => { assert.ok(value, msg); passed++; };
const fals = (value, msg) => { assert.ok(!value, msg); passed++; };
const mat = (value, re, msg) => { assert.match(value, re, msg); passed++; };

function mockReq(overrides) {
  const headers = (overrides && overrides.headers) || {};
  const req = {
    headers,
    query: (overrides && overrides.query) || {},
    get: name => headers[String(name).toLowerCase()]
  };
  return Object.assign(req, overrides || {});
}

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  return res;
}

(async () => {
  const adapter = createMemoryAdapter();

  // -------------------------------------------------------------------------
  // Session lifecycle: create → verify → expire → revoke
  // -------------------------------------------------------------------------
  const alice = await identity.ensureUser(adapter, 9001, { display_name: 'Alice', email: 'alice@test.local' });
  const created = await session.createSession(adapter, alice.id);

  tru(created.token && created.session, 'session returns raw token + row');
  tru(typeof created.token === 'string' && created.token.length >= 32, 'raw token has entropy');
  eq(created.session.user_id, alice.id, 'session bound to the user');

  // Only the SHA-256 hash is persisted — the raw token must never appear.
  for (const r of adapter.find('sessions', {})) {
    assert.notStrictEqual(r.token_hash, created.token, 'raw token never persisted');
    mat(r.token_hash, /^[0-9a-f]{64}$/, 'token_hash is a sha256 hex digest');
    passed++;
  }

  const verified = await session.verifySession(adapter, created.token);
  tru(verified, 'fresh token verifies');
  eq(verified.user.id, alice.id, 'verification resolves the user');
  eq(verified.session.token_hash, session.hashToken(created.token), 'row matched by hash');

  fals(await session.verifySession(adapter, 'deadbeef'), 'unknown token rejected');
  fals(await session.verifySession(adapter, 'x'.repeat(31)), 'short token rejected');
  fals(await session.verifySession(adapter, ''), 'empty token rejected');
  fals(await session.verifySession(adapter, null), 'null token rejected');

  // Expired sessions are rejected.
  await adapter.update('sessions', { id: created.session.id }, { expires_at: new Date(Date.now() - 60000).toISOString() });
  fals(await session.verifySession(adapter, created.token), 'expired session rejected');

  // TTL honours SESSION_TTL_HOURS and falls back to 24h.
  const prevTtl = process.env.SESSION_TTL_HOURS;
  process.env.SESSION_TTL_HOURS = '5';
  eq(session.sessionTtlMs(), 5 * 3600 * 1000, 'sessionTtlMs honours env');
  process.env.SESSION_TTL_HOURS = '0';
  eq(session.sessionTtlMs(), 24 * 3600 * 1000, 'non-positive ttl falls back to default');
  process.env.SESSION_TTL_HOURS = 'abc';
  eq(session.sessionTtlMs(), 24 * 3600 * 1000, 'invalid ttl falls back to default');
  delete process.env.SESSION_TTL_HOURS;
  eq(session.sessionTtlMs(), 24 * 3600 * 1000, 'default ttl is 24h');
  if (prevTtl === undefined) delete process.env.SESSION_TTL_HOURS; else process.env.SESSION_TTL_HOURS = prevTtl;

  // Revocation (logout).
  const s2 = await session.createSession(adapter, alice.id);
  eq(await session.revokeSession(adapter, s2.token), true, 'revoke returns true');
  fals(await session.verifySession(adapter, s2.token), 'revoked session rejected');
  eq(await session.revokeSession(adapter, s2.token), false, 'second revoke is a no-op');
  eq(await session.revokeSession(adapter, 'unknown'), false, 'revoke of unknown token is a no-op');

  const bob = await identity.ensureUser(adapter, 9002, { display_name: 'Bob', email: 'bob@test.local' });
  const s3 = await session.createSession(adapter, bob.id);
  await session.revokeAllForUser(adapter, bob.id);
  fals(await session.verifySession(adapter, s3.token), 'revokeAll invalidates the user sessions');

  // -------------------------------------------------------------------------
  // Client-supplied identity is never trusted (spoofing regression)
  // -------------------------------------------------------------------------
  const s4 = await session.createSession(adapter, alice.id);
  const requireSession = session.createRequireSession(() => adapter);

  // A forged x-user-id header without a valid session must be rejected.
  const spoofReq = mockReq({ headers: { authorization: '', 'x-user-id': String(alice.id) } });
  const spoofRes = mockRes();
  await requireSession(spoofReq, spoofRes, () => tru(false, 'spoofed x-user-id must not reach the handler'));
  eq(spoofRes.statusCode, 401, 'x-user-id header alone → 401');

  // The old placeholder gate accepted any ≥32-char x-founder-session header.
  // It must be rejected without a real founder session.
  const requireFounder = session.createRequireFounderSession(() => adapter);
  const oldStyleReq = mockReq({ headers: { 'x-founder-session': 'A'.repeat(40) } });
  const oldStyleRes = mockRes();
  await requireFounder(oldStyleReq, oldStyleRes, () => tru(false, 'forged founder header must not reach the handler'));
  eq(oldStyleRes.statusCode, 401, 'forged x-founder-session header → 401');

  // The ?session= query parameter is ignored as well.
  const queryReq = mockReq({ query: { session: 'B'.repeat(40) } });
  const queryRes = mockRes();
  await requireSession(queryReq, queryRes, () => tru(false, 'query session must be ignored'));
  eq(queryRes.statusCode, 401, '?session= query param → 401');

  // A valid session grants access and populates the request identity.
  const goodReq = mockReq({ headers: { authorization: 'Bearer ' + s4.token } });
  const goodRes = mockRes();
  let reached = false;
  await requireSession(goodReq, goodRes, () => { reached = true; });
  tru(reached, 'valid session reaches the handler');
  eq(goodReq.authUser.id, alice.id, 'authUser bound from the session, not from headers');

  // -------------------------------------------------------------------------
  // Founder authorization gate
  // -------------------------------------------------------------------------
  const FID = 777;
  const prevFid = process.env.TEOS_FOUNDER_TELEGRAM_ID;
  process.env.TEOS_FOUNDER_TELEGRAM_ID = String(FID);
  const founder = await identity.ensureUser(adapter, FID, { display_name: 'Founder', email: 'founder@test.local' });

  eq(await identity.isFounderUser(adapter, founder.id), true, 'founder recognized by telegram id');
  eq(await identity.isFounderUser(adapter, alice.id), false, 'non-founder not recognized');
  eq(await identity.isFounderUser(adapter, 999999), false, 'unknown user not recognized');

  const founderSession = await session.createSession(adapter, founder.id);
  const fReq = mockReq({ headers: { authorization: 'Bearer ' + founderSession.token } });
  const fRes = mockRes();
  let fReached = false;
  await requireFounder(fReq, fRes, () => { fReached = true; });
  tru(fReached, 'founder session reaches the handler');
  eq(fReq.authUser.id, founder.id, 'founder identity bound from session');

  // A valid session for a NON-founder is denied 403 (authenticated but not
  // authorized), never 401.
  const nonFounderReq = mockReq({ headers: { authorization: 'Bearer ' + s4.token } });
  const nonFounderRes = mockRes();
  await requireFounder(nonFounderReq, nonFounderRes, () => tru(false, 'non-founder must not pass the founder gate'));
  eq(nonFounderRes.statusCode, 403, 'non-founder with valid session → 403');

  // The founder gate fails closed when TEOS_FOUNDER_TELEGRAM_ID is unset.
  delete process.env.TEOS_FOUNDER_TELEGRAM_ID;
  const noEnvReq = mockReq({ headers: { authorization: 'Bearer ' + founderSession.token } });
  const noEnvRes = mockRes();
  await requireFounder(noEnvReq, noEnvRes, () => tru(false, 'founder gate must fail closed without env'));
  eq(noEnvRes.statusCode, 403, 'founder gate fails closed without TEOS_FOUNDER_TELEGRAM_ID');
  if (prevFid === undefined) delete process.env.TEOS_FOUNDER_TELEGRAM_ID; else process.env.TEOS_FOUNDER_TELEGRAM_ID = prevFid;

  // -------------------------------------------------------------------------
  // Session fixation: tokens are server-generated, never client-chosen
  // -------------------------------------------------------------------------
  const t1 = session.newToken();
  const t2 = session.newToken();
  assert.notStrictEqual(t1, t2, 'tokens are unique');
  passed++;
  mat(session.hashToken(t1), /^[0-9a-f]{64}$/, 'hashToken is a sha256 digest');

  eq(session.bearerToken({ get: () => 'Bearer ' + s4.token }), s4.token, 'bearer token extracted');
  eq(session.bearerToken({ get: () => 'Basic abc' }), null, 'non-bearer scheme rejected');
  eq(session.bearerToken({ get: () => undefined }), null, 'missing authorization header → null');
  eq(session.bearerToken({ get: () => 'Bearer' }), null, 'bearer without value → null');

  // The full /api/auth/entitlement + /api/auth/missions/increment flow derives
  // the user from the session adapter, i.e. the exact wiring used by the routes.
  const auth = require('../services/auth');
  eq(await auth.checkUserEntitlement(adapter, alice.id), false, 'user without workspace is not entitled');
  await identity.onboardWorkspace(adapter, { ownerUserId: alice.id, companyName: 'Alice Co', lang: 'en', plan: 'trial' });
  eq(await auth.checkUserEntitlement(adapter, alice.id), true, 'user with active workspace is entitled');
  const sub = await auth.incrementUserMissionUsage(adapter, alice.id, 2);
  eq(sub.missions_used, 2, 'mission increment applies to the session user');

  console.log(`\n✓ session authentication: lifecycle + spoofing + founder gate (${passed} assertions passed)`);
  console.log('  raw tokens hashed at rest · forged x-user-id/x-founder-session/?session rejected · founder = TEOS_FOUNDER_TELEGRAM_ID');
  process.exit(0);
})().catch(err => {
  console.error('✗ session test failed:', err);
  process.exit(1);
});
