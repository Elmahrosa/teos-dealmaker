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

// Reads only the trailing window of the vault to recover the last line's hash.
// The chain requires the previous entry's hash, but reading the whole file on
// every write is O(n) and dominates cost as the vault grows. The tail read is
// O(1) and always reflects the last persisted line, keeping chain-of-custody
// correct across the multiple processes that share the vault (bot + web).
const TAIL_WINDOW = 8192;

function lastLineHash() {
  if (!fs.existsSync(AUDIT_LOG)) return null;
  let fd;
  try {
    fd = fs.openSync(AUDIT_LOG, 'r');
    const size = fs.fstatSync(fd).size;
    if (!size) return null;
    const start = Math.max(0, size - TAIL_WINDOW);
    const len = size - start;
    const buffer = Buffer.alloc(len);
    fs.readSync(fd, buffer, 0, len, start);
    const content = buffer.toString('utf8');
    // The vault ends with a trailing newline; trim trailing whitespace so the
    // final real line is selected, not an empty tail.
    const trimmed = content.replace(/\s+$/, '');
    const newline = trimmed.lastIndexOf('\n');
    const lastLine = newline >= 0 ? trimmed.slice(newline + 1) : trimmed;
    // A last line as large as the window is almost certainly truncated;
    // fall back to the full read in that (never-happens-in-practice) case.
    if (lastLine.length >= TAIL_WINDOW) {
      const full = fs.readFileSync(AUDIT_LOG, 'utf8');
      const lines = full.split('\n').filter(line => line.trim());
      return lines.length ? (JSON.parse(lines[lines.length - 1]).hash || null) : null;
    }
    if (!lastLine.trim()) return null;
    const parsed = JSON.parse(lastLine.trim());
    return parsed.hash || null;
  } catch (_err) {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
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

// Returns the most recent `maxEntries` vault entries without reading the whole
// file. Reads backwards from the tail in bounded chunks, so cost scales with
// the entries actually returned, not the vault size. Used by dashboard and
// audit screens that previously did a full-file read on every render.
const TAIL_CHUNK = 64 * 1024;

function readTail(maxEntries) {
  if (!fs.existsSync(AUDIT_LOG)) return [];
  const maxLines = Math.max(1, Math.floor(Number(maxEntries)) || 1);
  let fd;
  try {
    fd = fs.openSync(AUDIT_LOG, 'r');
    const size = fs.fstatSync(fd).size;
    if (!size) return [];
    let end = size;
    let raw = '';
    let reachedStart = false;
    let lines = [];
    while (end > 0) {
      const start = Math.max(0, end - TAIL_CHUNK);
      const buf = Buffer.alloc(end - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      raw = buf.toString('utf8') + raw;
      reachedStart = start === 0;
      end = start;
      lines = raw.split('\n').filter(line => line.trim());
      // The first line is partial unless we reached the start of the file.
      if (!reachedStart) lines.shift();
      if (lines.length >= maxLines || reachedStart) break;
    }
    const last = lines.slice(-maxLines);
    const parsed = [];
    for (const line of last) {
      try { parsed.push(JSON.parse(line)); } catch (_err) { /* skip */ }
    }
    return parsed;
  } catch (_err) {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Returns vault entries whose timestamp starts with the given prefix
// (e.g. "2026-08-13" for today). Entries are appended chronologically, so the
// tail is scanned backwards until an older entry is found, making this
// proportional to the matched entries rather than the vault size.
function readTailSince(timestampPrefix) {
  if (!fs.existsSync(AUDIT_LOG)) return [];
  const prefix = String(timestampPrefix || '');
  let fd;
  try {
    fd = fs.openSync(AUDIT_LOG, 'r');
    const size = fs.fstatSync(fd).size;
    if (!size) return [];
    let end = size;
    let raw = '';
    while (end > 0) {
      const start = Math.max(0, end - TAIL_CHUNK);
      const buf = Buffer.alloc(end - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      raw = buf.toString('utf8') + raw;
      const reachedStart = start === 0;
      end = start;
      const lines = raw.split('\n').filter(line => line.trim());
      const complete = reachedStart ? lines : lines.slice(1);
      if (!complete.length) continue;
      const parsed = [];
      for (const line of complete) {
        try { parsed.push(JSON.parse(line)); } catch (_err) { /* skip */ }
      }
      if (!parsed.length) continue;
      const oldest = parsed[0];
      if (!prefix || String(oldest.timestamp || '').localeCompare(prefix) < 0) {
        return parsed.filter(e => String(e.timestamp || '').startsWith(prefix));
      }
      if (reachedStart) return parsed;
    }
    return [];
  } catch (_err) {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
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
  readTail,
  readTailSince,
  clearVault,
  syncVaultToDb,
  verifyVault,
  countEntries,
  timestamp
};
