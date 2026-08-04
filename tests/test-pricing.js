const PRICING = require('../config/pricing.config');
const { formatPricingText, pricingButtons } = require('../config/pricing.config');
const ADDONS = PRICING.ADDONS;

console.log('Testing Pricing Config...\n');

let ok = true;

const TIER_NAMES = ['Starter', 'Growth', 'Business', 'Enterprise'];
const URL_MAP = [
  { tier: 'Starter', monthly: 'DODO_STARTER_MONTHLY_URL', annual: 'DODO_STARTER_ANNUAL_URL' },
  { tier: 'Growth', monthly: 'DODO_GROWTH_MONTHLY_URL', annual: 'DODO_GROWTH_ANNUAL_URL' },
  { tier: 'Business', monthly: 'DODO_BUSINESS_MONTHLY_URL', annual: 'DODO_BUSINESS_ANNUAL_URL' }
];

if (PRICING.length !== 4) {
  console.log('FAIL: expected 4 tiers'); ok = false;
}

TIER_NAMES.forEach(name => {
  if (!PRICING.some(t => t.tier.endsWith(name))) {
    console.log(`FAIL: missing tier ${name}`); ok = false;
  }
});

PRICING.forEach(t => {
  const custom = !!t.custom;
  const priceOk = custom
    ? t.monthly.price === 'Custom' && t.annual.price === 'Custom'
    : /^\$\d/.test(t.monthly.price) && /^\$\d/.test(t.annual.price);
  if (!priceOk) { console.log(`FAIL: ${t.tier} invalid price format`); ok = false; }

  const urls = [t.monthly.url, t.annual.url].filter(Boolean);
  urls.forEach(u => {
    if (u.includes('dodo.pe')) { console.log(`FAIL: ${t.tier} hardcoded checkout URL`); ok = false; }
    if (!/^https:\/\//.test(u)) { console.log(`FAIL: ${t.tier} non-https checkout URL`); ok = false; }
  });

  if (!custom) {
    const pids = [t.productIds.monthly, t.productIds.annual].filter(Boolean);
    pids.forEach(p => {
      if (!p.startsWith('pdt_')) { console.log(`FAIL: ${t.tier} invalid product ID`); ok = false; }
    });
  }
});

URL_MAP.forEach(m => {
  const t = PRICING.find(p => p.tier.endsWith(m.tier));
  const expMonthly = process.env[m.monthly] || '';
  const expAnnual = process.env[m.annual] || '';
  const pidMonthly = m.monthly.replace('URL', 'PID');
  const pidAnnual = m.annual.replace('URL', 'PID');
  if (t.monthly.url !== expMonthly) { console.log(`FAIL: ${m.tier} monthly URL not env-driven`); ok = false; }
  if (t.annual.url !== expAnnual) { console.log(`FAIL: ${m.tier} annual URL not env-driven`); ok = false; }
  if (t.productIds.monthly !== (process.env[pidMonthly] || '')) { console.log(`FAIL: ${m.tier} monthly PID not env-driven`); ok = false; }
  if (t.productIds.annual !== (process.env[pidAnnual] || '')) { console.log(`FAIL: ${m.tier} annual PID not env-driven`); ok = false; }
});

if (!ADDONS || ADDONS.length < 5 || !ADDONS.some(a => a.name === 'Sentinel Governance')) {
  console.log('FAIL: missing add-ons catalog'); ok = false;
}

const text = formatPricingText();
const buttons = pricingButtons().inline_keyboard;

TIER_NAMES.forEach(name => {
  if (!text.includes(name)) { console.log(`FAIL: formatted text missing ${name}`); ok = false; }
});
if (!text.includes('Add-ons') || !text.includes('Sentinel Governance')) {
  console.log('FAIL: formatted text missing add-ons'); ok = false;
}

buttons.forEach(row => {
  if (row.length > 2 || row.some(b => !/^https:\/\//.test(b.url))) {
    console.log('FAIL: malformed pricing button row'); ok = false;
  }
});

console.log(ok ? 'ALL PRICING CHECKS PASS' : 'PRICING CHECKS FAILED');
if (!ok) process.exit(1);

PRICING.forEach(t => console.log(`${t.tier}: monthly ${t.monthly.price} | annual ${t.annual.price}`));
