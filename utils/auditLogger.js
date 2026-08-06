const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VAULT_DIR = path.join(__dirname, '..', 'data', 'vault');
if (!fs.existsSync(VAULT_DIR)) {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
}

const AUDIT_LOG = path.join(VAULT_DIR, 'audit.log');

function timestamp() {
  return new Date().toISOString();
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

// Chain-of-custody hashing: every entry records the hash of the previous
// entry and its own hash over (timestamp, action, target, status, details,
// prev). Any edit to a historical entry breaks the chain and is detected by
// verifyVault(). Note: this detects tampering; it cannot prevent deletion of
// the file itself, so the vault directory must stay write-protected.
function hashOf(entry) {
  const payload = JSON.stringify({
    timestamp: entry.timestamp,
    action: entry.action,
    target: entry.target,
    status: entry.status,
    details: entry.details,
    prev: entry.prev || null
  });
  return sha256(payload);
}

function lastLineHash() {
  if (!fs.existsSync(AUDIT_LOG)) return null;
  const content = fs.readFileSync(AUDIT_LOG, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());
  if (!lines.length) return null;
  try {
    const last = JSON.parse(lines[lines.length - 1]);
    return last.hash || null;
  } catch (_err) {
    return null;
  }
}

function mirrorToDb(entry) {
  if (!process.env.DATABASE_URL) return;
  try {
    const { getAdapter } = require('../db');
    const agentName = (entry.action.split('_')[0] || 'system').toLowerCase();
    getAdapter()
      .insert('audit_trail', {
        workspace_id: null,
        deal_id: null,
        timestamp: entry.timestamp,
        agent_name: agentName,
        action_type: entry.action,
        details: entry.details,
        version: 'v0.1.0'
      })
      .catch(err => console.error('[auditLogger] Postgres mirror failed:', err.message));
  } catch (err) {
    console.error('[auditLogger] Postgres mirror init failed:', err.message);
  }
}

function writeEntry(action, target, status, details) {
  const entry = {
    timestamp: timestamp(),
    action,
    target,
    status,
    details,
    prev: lastLineHash()
  };
  entry.hash = hashOf(entry);

  const line = JSON.stringify(entry);
  fs.appendFileSync(AUDIT_LOG, line + '\n', 'utf8');
  mirrorToDb(entry);
  return entry;
}

// Returns { valid, entries, firstBad } where firstBad is the 1-based line
// number of the first entry that fails parse, chain or hash verification.
function verifyVault() {
  if (!fs.existsSync(AUDIT_LOG)) {
    return { valid: true, entries: 0, firstBad: null };
  }
  const content = fs.readFileSync(AUDIT_LOG, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());
  let prevHash = null;
  for (let i = 0; i < lines.length; i++) {
    let parsed;
    try {
      parsed = JSON.parse(lines[i]);
    } catch (_err) {
      return { valid: false, entries: i, firstBad: i + 1 };
    }
    const expectedPrev = prevHash || null;
    if (parsed.prev !== expectedPrev) {
      return { valid: false, entries: i, firstBad: i + 1 };
    }
    if (hashOf(parsed) !== parsed.hash) {
      return { valid: false, entries: i, firstBad: i + 1 };
    }
    prevHash = parsed.hash;
  }
  return { valid: true, entries: lines.length, firstBad: null };
}

async function syncVaultToDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set. Cannot sync to PostgreSQL.');
  }
  const { getAdapter } = require('../db');
  const adapter = getAdapter();
  const entries = readVault();
  let inserted = 0;
  let failed = 0;

  for (const entry of entries) {
    const agentName = (entry.action.split('_')[0] || 'system').toLowerCase();
    try {
      await adapter.insert('audit_trail', {
        workspace_id: null,
        deal_id: null,
        timestamp: entry.timestamp,
        agent_name: agentName,
        action_type: entry.action,
        details: entry.details,
        version: 'v0.1.0'
      });
      inserted++;
    } catch (err) {
      failed++;
      console.error(`[auditLogger] sync failed for ${entry.action}:`, err.message);
    }
  }

  return { inserted, failed };
}

function readVault() {
  if (!fs.existsSync(AUDIT_LOG)) {
    return [];
  }

  const content = fs.readFileSync(AUDIT_LOG, 'utf8');
  return content
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

function countEntries() {
  if (!fs.existsSync(AUDIT_LOG)) return 0;
  const content = fs.readFileSync(AUDIT_LOG, 'utf8');
  let count = 0;
  for (const ch of content) {
    if (ch === '\n') count++;
  }
  return count;
}

function clearVault() {
  if (fs.existsSync(AUDIT_LOG)) {
    fs.unlinkSync(AUDIT_LOG);
  }
}

module.exports = {
  writeEntry,
  readVault,
  clearVault,
  syncVaultToDb,
  verifyVault,
  countEntries,
  timestamp
};
