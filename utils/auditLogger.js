const fs = require('fs');
const path = require('path');

const VAULT_DIR = path.join(__dirname, '..', 'data', 'vault');
if (!fs.existsSync(VAULT_DIR)) {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
}

const AUDIT_LOG = path.join(VAULT_DIR, 'audit.log');

function timestamp() {
  return new Date().toISOString();
}

function mirrorToDb(entry) {
  if (!process.env.DATABASE_URL) return;
  const { getPool } = require('../db');
  const agentName = (entry.action.split('_')[0] || 'system').toLowerCase();
  getPool()
    .query(
      `INSERT INTO audit_trail (deal_id, timestamp, agent_name, action_type, details, version)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [null, entry.timestamp, agentName, entry.action, entry.details, 'v0.1.0']
    )
    .catch(err => console.error('[auditLogger] Postgres mirror failed:', err.message));
}

function writeEntry(action, target, status, details) {
  const entry = {
    timestamp: timestamp(),
    action,
    target,
    status,
    details
  };

  const line = JSON.stringify(entry);
  fs.appendFileSync(AUDIT_LOG, line + '\n', 'utf8');
  mirrorToDb(entry);
  return entry;
}

async function syncVaultToDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set. Cannot sync to PostgreSQL.');
  }
  const { getPool } = require('../db');
  const entries = readVault();
  let inserted = 0;
  let failed = 0;

  for (const entry of entries) {
    const agentName = (entry.action.split('_')[0] || 'system').toLowerCase();
    try {
      await getPool().query(
        `INSERT INTO audit_trail (deal_id, timestamp, agent_name, action_type, details, version)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [null, entry.timestamp, agentName, entry.action, entry.details, 'v0.1.0']
      );
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
  timestamp
};
