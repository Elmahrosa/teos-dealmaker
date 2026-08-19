// Billing mode configuration
// Supports: dodo (automated), manual_pilot (founder-approved), trial (limited)
let BILLING_MODE = process.env.BILLING_MODE || 'dodo';

function setMode(newMode) {
  const validModes = ['dodo', 'manual_pilot', 'trial'];
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

function isDodo() {
  return BILLING_MODE === 'dodo';
}

function isManualPilot() {
  return BILLING_MODE === 'manual_pilot';
}

function isTrial() {
  return BILLING_MODE === 'trial';
}

function requiresDodoCredentials() {
  return BILLING_MODE === 'dodo';
}

module.exports = { setMode, getMode, isDodo, isManualPilot, isTrial, requiresDodoCredentials };
