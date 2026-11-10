'use strict';

const assert = require('assert');
const billing = require('../services/billing');
const config = require('../config/billing');

assert.deepStrictEqual(Object.keys(billing.EVENT_HANDLERS), ['manual_pilot.activated']);
assert.strictEqual(typeof billing.isEntitled, 'function');
assert.strictEqual(typeof billing.incrementMissionsUsed, 'function');
assert.strictEqual(typeof billing.handleEvent, 'function');
assert.strictEqual(typeof billing.verifySignature, 'undefined');
assert.strictEqual(typeof billing.getPlanForProduct, 'undefined');

assert.throws(() => config.setMode('dodo'));
assert.throws(() => config.setMode('external'));

config.setMode('manual_pilot');
assert.strictEqual(config.getMode(), 'manual_pilot');
assert.strictEqual(config.isManualPilot(), true);

config.setMode('trial');
assert.strictEqual(config.getMode(), 'trial');
assert.strictEqual(config.isTrial(), true);

config.setMode('manual_pilot');
console.log('PASS: provider-free billing contract');
