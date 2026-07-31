const PRICING = require('../config/pricing.config');
const { formatPricingText, pricingButtons } = require('../config/pricing.config');

console.log("Testing Pricing Config...\n");

let ok = true;

if (PRICING.length !== 3) { console.log("FAIL: expected 3 tiers"); ok = false; }

PRICING.forEach(t => {
  if (!/^https:\/\/dodo\.pe\//.test(t.monthly.url) || !/^https:\/\/dodo\.pe\//.test(t.annual.url)) {
    console.log(`FAIL: ${t.tier} has non-dodo.pe URL`); ok = false;
  }
  if (!/^\$\d/.test(t.monthly.price) || !/^\$\d/.test(t.annual.price)) {
    console.log(`FAIL: ${t.tier} has invalid price format`); ok = false;
  }
  if (!t.productIds.monthly.startsWith('pdt_') || !t.productIds.annual.startsWith('pdt_')) {
    console.log(`FAIL: ${t.tier} missing product ID`); ok = false;
  }
});

const text = formatPricingText();
const buttons = pricingButtons().inline_keyboard;

if (!text.includes('Solo Operator') || !text.includes('Growth Team') || !text.includes('Corporate')) {
  console.log("FAIL: formatted text missing tiers"); ok = false;
}
if (buttons.length !== 3 || buttons[0].length !== 2) {
  console.log("FAIL: expected 3 rows x 2 url buttons"); ok = false;
}

console.log(ok ? "ALL PRICING CHECKS PASS" : "PRICING CHECKS FAILED");
if (!ok) process.exit(1);

PRICING.forEach(t => console.log(`${t.tier}: monthly ${t.monthly.price} | annual ${t.annual.price}`));
