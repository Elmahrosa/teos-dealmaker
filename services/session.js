// services/session.js
// Server-side session store for authenticated web identity (issue #17).
// Opaque bearer tokens are issued at login/web-login; only their SHA-256
// hashes are persisted, so a database leak does not expose usable sessions.
// Verification is fail-closed: expired or revoked sessions are rejected, and
// session identity is never derived from client-supplied headers or fields
// (x-user-id, x-founder-session, query params, body fields are all ignored).
'use strict';

const crypto = require('crypto');
const { createRepos } = require('../db/repos');
const identity = require('./identity');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function sessionTtlMs() {
  const hours = Number(process.env.SESSION_TTL_HOURS);
  if (Number.isFinite(hours) && hours > 0) return hours * 60 * 60 * 1000;
  return DEFAULT_TTL_MS;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Sessions are always freshly generated server-side. No client-supplied
// identifier is ever accepted, which prevents session fixation.
function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function resolveAdapter() {
  try {
    return require('../db').getAdapter();
  } catch (_err) {
    return require('../db').createMemoryAdapter();
  }
}

function bearerToken(req) {
  const header = req && req.get ? req.get('authorization') : (req && req.headers && req.headers.authorization);
  if (!header) return null;
  const m = /^Bearer\s+([^\s]+)$/i.exec(String(header).trim());
  return m ? m[1] : null;
}

async function createSession(adapter, userId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs()).toISOString();
  const repos = createRepos(adapter);
  const session = await repos.sessions.create({
    token_hash: hashToken(token),
    user_id: userId,
    expires_at: expiresAt
  });
  return { token, session };
}

async function verifySession(adapter, token) {
  if (!token || typeof token !== 'string' || token.length < 32) return null;
  const repos = createRepos(adapter);
  const session = await repos.sessions.getByTokenHash(hashToken(token));
  if (!session) return null;
  if (session.revoked_at) return null;
  if (!session.expires_at || new Date(session.expires_at).getTime() < Date.now()) return null;
  const user = await repos.users.getById(session.user_id);
  if (!user) return null;
  return { session, user };
}

async function revokeSession(adapter, token) {
  if (!token || typeof token !== 'string') return false;
  const repos = createRepos(adapter);
  const session = await repos.sessions.getByTokenHash(hashToken(token));
  if (!session || session.revoked_at) return false;
  await repos.sessions.revoke(session.id);
  return true;
}

async function revokeAllForUser(adapter, userId) {
  const repos = createRepos(adapter);
  const sessions = await repos.sessions.getByUser(userId);
  for (const s of sessions) {
    if (!s.revoked_at) await repos.sessions.revoke(s.id);
  }
  return sessions.length;
}

// Express middleware factories. `resolve` is injectable for tests; the default
// resolves the process-wide adapter exactly like the routes do.
function createRequireSession(resolve) {
  const getAdapter = resolve || resolveAdapter;
  return async function requireSession(req, res, next) {
    try {
      const token = bearerToken(req);
      if (!token) return res.status(401).json({ ok: false, error: 'Authentication required' });
      const adapter = await getAdapter();
      const verified = await verifySession(adapter, token);
      if (!verified) return res.status(401).json({ ok: false, error: 'Invalid or expired session' });
      req.adapter = adapter;
      req.authUser = verified.user;
      req.sessionRow = verified.session;
      req.sessionToken = token;
      return next();
    } catch (_err) {
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  };
}

function createRequireFounderSession(resolve) {
  const getAdapter = resolve || resolveAdapter;
  return async function requireFounderSession(req, res, next) {
    try {
      const token = bearerToken(req);
      if (!token) return res.status(401).json({ ok: false, error: 'Authentication required' });
      const adapter = await getAdapter();
      const verified = await verifySession(adapter, token);
      if (!verified) return res.status(401).json({ ok: false, error: 'Invalid or expired session' });
      const isFounder = await identity.isFounderUser(adapter, verified.user.id);
      if (!isFounder) return res.status(403).json({ ok: false, error: 'Forbidden: Founder access required' });
      req.adapter = adapter;
      req.authUser = verified.user;
      req.sessionRow = verified.session;
      req.sessionToken = token;
      return next();
    } catch (_err) {
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  };
}

module.exports = {
  sessionTtlMs,
  hashToken,
  newToken,
  bearerToken,
  createSession,
  verifySession,
  revokeSession,
  revokeAllForUser,
  createRequireSession,
  createRequireFounderSession,
  requireSession: createRequireSession(),
  requireFounderSession: createRequireFounderSession()
};
