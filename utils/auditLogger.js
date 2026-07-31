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
  return entry;
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
  timestamp
};
