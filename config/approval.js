'use strict';

// Global approval mode chosen by the Founder.
//   automatic   — steps that would pause for approval run straight through.
//   manual      — default: high-risk / low-confidence steps pause for approval.
//   simulation  — everything runs and is logged, nothing is treated as live output.
// Customer behavior is unchanged unless the Founder changes the global mode.

const fs = require('fs');
const path = require('path');

const MODES = ['automatic', 'manual', 'simulation'];
const FILE = path.join(__dirname, '..', 'data', 'approval.json');

let MODE = 'manual';
if (process.env.NODE_ENV !== 'test') {
  try {
    const stored = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (MODES.includes(stored.mode)) MODE = stored.mode;
  } catch (_) { /* default manual */ }
}

function setApprovalMode(mode) {
  if (!MODES.includes(mode)) {
    throw new Error('Approval mode must be automatic, manual or simulation');
  }
  MODE = mode;
  if (process.env.NODE_ENV !== 'test') {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify({ mode: MODE }, null, 2), 'utf8');
    } catch (err) {
      console.error('[approval] persist failed:', err.message);
    }
  }
  console.log(`[APPROVAL] Mode: ${MODE}`);
  return MODE;
}

function getApprovalMode() {
  return MODE;
}

function autoApproves() {
  return MODE === 'automatic' || MODE === 'simulation';
}

function isSimulation() {
  return MODE === 'simulation';
}

module.exports = {
  MODES,
  setApprovalMode,
  getApprovalMode,
  autoApproves,
  isSimulation
};
