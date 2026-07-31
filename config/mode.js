// Global mode switch
let MODE = process.env.TEOS_MODE || 'DRY';

function setMode(newMode) {
  if (!['DRY', 'LIVE'].includes(newMode)) {
    throw new Error('Mode must be DRY or LIVE');
  }
  MODE = newMode;
  console.log(`[MODE] Switched to: ${MODE}`);
  return MODE;
}

function getMode() {
  return MODE;
}

function isDRY() {
  return MODE === 'DRY';
}

function isLIVE() {
  return MODE === 'LIVE';
}

module.exports = { setMode, getMode, isDRY, isLIVE };
