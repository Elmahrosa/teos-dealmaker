// plugins/civic-mixer/authority.js
// ICBC Authorization Stamp — structural verification per the International
// Civic Blockchain Constitution, Article IX, and
// docs/09_AUTHORIZATION_STAMP_SPEC.md ("Elmahrosa Law over Code").
//
// This module is READ-ONLY: it verifies, it never issues. Executing write
// capabilities (civic.vote.create, civic.issue.create) requires a valid
// Authorization Stamp proving the action traversed the Sovereign Authority
// Chain and received explicit human institutional approval. Cryptographic
// signature verification (governance + safety) is performed by the Execution
// Kernel against the registered public-key registry; this transport plugin
// verifies structure, canonical STAMP_HASH integrity, bounded scope, and
// expiry so an invalid stamp is rejected before any I/O.
'use strict';

const crypto = require('crypto');

const STAMP_VERSION = 'AUTH-1.0';

const REQUIRED_FIELDS = [
  'stamp_version',
  'action_id',
  'action_type',
  'request_hash',
  'authority_chain_hash',
  'initiator_pubkey',
  'governance_signature',
  'safety_signature',
  'execution_scope',
  'issued_at_utc'
];

const FORBIDDEN_SCOPE = ['ANY', 'ALL'];

function isHex64(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIso8601Utc(value) {
  if (typeof value !== 'string' || !value) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  const rounded = new Date(parsed);
  return value.includes('Z') || rounded.getUTCHours().toString().length <= 2;
}

function canonicalize(stamp) {
  const sorted = {};
  for (const key of Object.keys(stamp).sort()) sorted[key] = stamp[key];
  return JSON.stringify(sorted);
}

function computeStampHash(stamp) {
  return crypto.createHash('sha256').update(canonicalize(stamp), 'utf8').digest('hex');
}

function verifyStamp(stamp, context) {
  const ctx = context || {};
  if (!stamp || typeof stamp !== 'object' || Array.isArray(stamp)) {
    return { ok: false, reason: 'authorization_stamp_required' };
  }

  const missing = REQUIRED_FIELDS.filter((field) => !isNonEmptyString(stamp[field])
    && !(field === 'execution_scope' && Array.isArray(stamp[field]) && stamp[field].length > 0));
  if (missing.length) {
    return { ok: false, reason: 'invalid_authorization_stamp', detail: `missing_fields: ${missing.join(',')}` };
  }

  if (stamp.stamp_version !== STAMP_VERSION) {
    return { ok: false, reason: 'invalid_authorization_stamp', detail: `unsupported_stamp_version: ${stamp.stamp_version}` };
  }
  if (!isHex64(stamp.request_hash)) {
    return { ok: false, reason: 'invalid_authorization_stamp', detail: 'request_hash_must_be_sha256_hex' };
  }
  if (!isHex64(stamp.authority_chain_hash)) {
    return { ok: false, reason: 'invalid_authorization_stamp', detail: 'authority_chain_hash_must_be_sha256_hex' };
  }
  if (!isNonEmptyString(stamp.governance_signature)) {
    return { ok: false, reason: 'invalid_authorization_stamp', detail: 'governance_signature_required' };
  }
  if (!isNonEmptyString(stamp.safety_signature)) {
    return { ok: false, reason: 'invalid_authorization_stamp', detail: 'safety_signature_required' };
  }
  if (stamp.safety_signature === stamp.governance_signature) {
    return { ok: false, reason: 'invalid_authorization_stamp', detail: 'self_authorization_attempt' };
  }
  if (!Array.isArray(stamp.execution_scope) || stamp.execution_scope.length === 0) {
    return { ok: false, reason: 'invalid_authorization_stamp', detail: 'execution_scope_required' };
  }
  if (stamp.execution_scope.some((item) => FORBIDDEN_SCOPE.includes(String(item).toUpperCase()))) {
    return { ok: false, reason: 'invalid_authorization_stamp', detail: 'unbounded_execution_scope' };
  }
  if (ctx.actionType && !stamp.execution_scope.includes(ctx.actionType)) {
    return { ok: false, reason: 'authorization_scope_exceeded', detail: `action_type:${ctx.actionType}` };
  }
  if (!isIso8601Utc(stamp.issued_at_utc)) {
    return { ok: false, reason: 'invalid_authorization_stamp', detail: 'issued_at_utc_must_be_iso8601' };
  }
  if (Date.parse(stamp.issued_at_utc) > Date.now() + 60000) {
    return { ok: false, reason: 'authorization_stamp_not_yet_valid', detail: 'issued_in_future' };
  }
  if (stamp.expiry_utc !== undefined && stamp.expiry_utc !== null && stamp.expiry_utc !== '') {
    if (!isIso8601Utc(stamp.expiry_utc)) {
      return { ok: false, reason: 'invalid_authorization_stamp', detail: 'expiry_utc_must_be_iso8601' };
    }
    if (Date.parse(stamp.expiry_utc) <= Date.now()) {
      return { ok: false, reason: 'authorization_stamp_expired' };
    }
  }

  let stampHash = null;
  try {
    stampHash = computeStampHash(stamp);
  } catch (_) {
    return { ok: false, reason: 'invalid_authorization_stamp', detail: 'canonicalization_failed' };
  }
  if (stamp.stamp_hash !== undefined && stamp.stamp_hash !== null && stamp.stamp_hash !== '' && stamp.stamp_hash !== stampHash) {
    return { ok: false, reason: 'invalid_authorization_stamp', detail: 'stamp_hash_mismatch' };
  }

  return { ok: true, stampHash, actionId: stamp.action_id, actionType: stamp.action_type };
}

module.exports = { STAMP_VERSION, REQUIRED_FIELDS, verifyStamp, computeStampHash, canonicalize };
