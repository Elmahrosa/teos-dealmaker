'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const pricing = require('../config/pricing.config');

assert.strictEqual(pricing.length, 0, 'No commercial pricing tiers are published');
assert.deepStrictEqual(pricing.ADDONS, [], 'No paid add-ons are published');

for (const p of [
  'server/landing.html',
  'server/render.js',
  'scripts/audit-links.js',
  'public/dashboard/index.html',
  'config/pricing.config.js'
]) {
  const content = read(p).toLowerCase();
  assert(!content.includes('dodopayments'), `${p} must not contain Dodo checkout references`);
  assert(!content.includes('checkout.dodo'), `${p} must not contain Dodo checkout URLs`);
}

console.log('PASS: active landing, dashboard, pricing and link audit contain no Dodo checkout integration.');