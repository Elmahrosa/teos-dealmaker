// Founder-only Emergency Stop
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(process.cwd(), 'data', 'emergency.json');

function read() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { engaged: parsed.engaged === true, updatedAt: parsed.updatedAt || null };
  } catch (_err) {
    return { engaged: false, updatedAt: null };
  }
}

function isEngaged() {
  return read().engaged === true;
}

function setEmergencyStop(engaged) {
  const state = { engaged: engaged === true, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  console.log(`[EMERGENCY] ${engaged ? 'ENGAGED' : 'disengaged'}`);
  return state;
}

module.exports = { isEngaged, setEmergencyStop, read };
