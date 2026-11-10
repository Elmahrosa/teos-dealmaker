// Billing mode configuration
// Supports: manual_pilot (founder-approved), trial (limited)
let BILLING_MODE = process.env.BILLING_MODE || 'manual_pilot';

function setMode(newMode) {
  const validModes = ['manual_pilot', 'trial'];
  if (!validModes.includes(newMode)) {
    throw new Error(`Billing mode must be one of: ${validModes.join(', ')}`);
  }
  BILLING_MODE = newMode;
  console.log(`[BILLING_MODE] Switched to: ${BILLING_MODE}`);
  return BILLING_MODE;
}

function getMode() {
  return BILLING_MODE;
}

function isManualPilot() {
  return BILLING_MODE === 'manual_pilot';
}

function isTrial() {
  return BILLING_MODE === 'trial';
}

module.exports = { setMode, getMode, isManualPilot, isTrial };