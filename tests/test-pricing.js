'use strict';

const assert = require('assert');
const PRICING = require('../config/pricing.config');
const { formatPricingText, pricingButtons, ADDONS, SENTINEL_URL } = require('../config/pricing.config');

assert(Array.isArray(PRICING), 'Pricing export remains an array');
assert.strictEqual(PRICING.length, 0, 'No commercial plans are published');
assert.deepStrictEqual(ADDONS, [], 'No add-on catalog is published');
assert.deepStrictEqual(pricingButtons('en'), { inline_keyboard: [] }, 'No checkout buttons are exposed');
assert.deepStrictEqual(pricingButtons('ar'), { inline_keyboard: [] }, 'No Arabic checkout buttons are exposed');
assert.match(formatPricingText('en'), /not published/i, 'English copy states pricing is unpublished');
assert.match(formatPricingText('ar'), /غير منشورة/, 'Arabic copy states pricing is unpublished');
assert.strictEqual(SENTINEL_URL, 'https://sentinel.teosegypt.com', 'Sentinel remains a separate product link');

console.log('PASS: DealMaker pricing is unpublished; no tiers, add-ons, or checkout links.');