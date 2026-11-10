'use strict';

const assert = require('assert');
const billing = require('../services/billing');
const config = require('../config/billing');

async function main() {
  config.setMode('manual_pilot');
  assert.strictEqual(config.getMode(), 'manual_pilot');
  assert.strictEqual(config.isManualPilot(), true);
  assert.strictEqual(config.isTrial(), false);

  config.setMode('trial');
  assert.strictEqual(config.getMode(), 'trial');
  assert.strictEqual(config.isTrial(), true);
  assert.strictEqual(config.isManualPilot(), false);

  assert.throws(() => config.setMode('dodo'));
  assert.throws(() => config.setMode('external'));

  assert.deepStrictEqual(
    Object.keys(billing.EVENT_HANDLERS),
    ['manual_pilot.activated']
  );

  assert.strictEqual(typeof billing.isEntitled, 'function');
  assert.strictEqual(typeof billing.incrementMissionsUsed, 'function');

  config.setMode('manual_pilot');
  console.log('PASS: Manual Pilot and trial billing tests');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
