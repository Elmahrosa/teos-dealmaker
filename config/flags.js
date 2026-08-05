// Founder-only Feature Flags
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(process.cwd(), 'data', 'features.json');

const DEFAULTS = {
  missions: true,
  sales: true,
  pipeline: true,
  intelligence: true,
  integrations: true
};

function read() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Object.assign({}, DEFAULTS, parsed);
  } catch (_err) {
    return Object.assign({}, DEFAULTS);
  }
}

function list() {
  return read();
}

function isEnabled(key) {
  return read()[key] !== false;
}

function setFlag(key, value) {
  const flags = read();
  if (!(key in DEFAULTS)) {
    throw new Error('Unknown feature flag: ' + key);
  }
  flags[key] = value === true;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(flags, null, 2));
  console.log(`[FLAGS] ${key} → ${flags[key] ? 'ON' : 'OFF'}`);
  return flags;
}

module.exports = { list, isEnabled, setFlag };
