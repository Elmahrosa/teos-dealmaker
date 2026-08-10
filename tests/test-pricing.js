const PRICING = require('../config/pricing.config');
const { formatPricingText, pricingButtons } = require('../config/pricing.config');
const ADDONS = PRICING.ADDONS;

console.log('Testing Pricing Config...\n');

let ok = true;

const TIER_NAMES = ['Solo', 'Growth', 'Business', 'Enterprise'];

// Sentinel is a SEPARATE product. Its Dodo product must never appear in the
// DealMaker commerce surface; only a plain external cross-link is allowed.
const SENTINEL_PID = 'pdt_0NiubmDStYOWzNVUkcFC8';
const SENTINEL_URL = 'https://sentinel.teosegypt.com';

// Founder-provided canonical Dodo commercial mapping. These checkout URLs and
// product ids are public payment links — never API credentials.
const CANONICAL = [
  {
    tier: 'Solo',
    monthly: {
      url: 'https://checkout.dodopayments.com/buy/pdt_0NkdQVk7ahfyz0VSoTGip',
      shortUrl: 'https://dodo.pe/teos-dealmaker-solo-monthly-13644952',
      pid: 'pdt_0NkdQVk7ahfyz0VSoTGip',
      env: 'DODO_STARTER_MONTHLY_URL'
    },
    annual: {
      url: 'https://checkout.dodopayments.com/buy/pdt_0NkdQW1mGZrFIxz9dm7eZ',
      shortUrl: 'https://dodo.pe/teos-dealmaker-solo-annual-13644952',
      pid: 'pdt_0NkdQW1mGZrFIxz9dm7eZ',
      env: 'DODO_STARTER_ANNUAL_URL'
    }
  },
  {
    tier: 'Growth',
    monthly: {
      url: 'https://checkout.dodopayments.com/buy/pdt_0NkdQWCpT2SbojpuscwVI',
      shortUrl: 'https://dodo.pe/teos-dealmaker-growth-monthly-13644952',
      pid: 'pdt_0NkdQWCpT2SbojpuscwVI',
      env: 'DODO_GROWTH_MONTHLY_URL'
    },
    annual: {
      url: 'https://checkout.dodopayments.com/buy/pdt_0NkdQWOkJWfbSa7qtCLZm',
      shortUrl: 'https://dodo.pe/teos-dealmaker-growth-annual-13644952',
      pid: 'pdt_0NkdQWOkJWfbSa7qtCLZm',
      env: 'DODO_GROWTH_ANNUAL_URL'
    }
  },
  {
    tier: 'Business',
    monthly: {
      url: 'https://checkout.dodopayments.com/buy/pdt_0NkdQWZ1Bkv413NqbbVFu',
      shortUrl: 'https://dodo.pe/teos-dealmaker-business-monthly-13644952',
      pid: 'pdt_0NkdQWZ1Bkv413NqbbVFu',
      env: 'DODO_BUSINESS_MONTHLY_URL'
    },
    annual: {
      url: 'https://checkout.dodopayments.com/buy/pdt_0NkdQWgxl0hJcb4skW8IK',
      shortUrl: 'https://dodo.pe/teos-dealmaker-business-annual-13644952',
      pid: 'pdt_0NkdQWgxl0hJcb4skW8IK',
      env: 'DODO_BUSINESS_ANNUAL_URL'
    }
  }
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
    if (u.includes('dodo.pe')) { console.log(`FAIL: ${t.tier} checkout URL must not be a short link`); ok = false; }
    if (!/^https:\/\//.test(u)) { console.log(`FAIL: ${t.tier} non-https checkout URL`); ok = false; }
    if (!/^https:\/\/checkout\.dodopayments\.com\/buy\/pdt_/.test(u)) {
      console.log(`FAIL: ${t.tier} checkout URL must be a real Dodo checkout page`); ok = false;
    }
  });

  if (!custom) {
    const pids = [t.productIds.monthly, t.productIds.annual].filter(Boolean);
    pids.forEach(p => {
      if (!p.startsWith('pdt_')) { console.log(`FAIL: ${t.tier} invalid product ID`); ok = false; }
    });
    const m = t.monthly.priceCents;
    const a = t.annual.priceCents;
    if (typeof m !== 'number' || typeof a !== 'number' || !(a < m * 12)) {
      console.log(`FAIL: ${t.tier} annual savings not demonstrated`); ok = false;
    }
  }
});

CANONICAL.forEach(m => {
  const t = PRICING.find(p => p.tier.endsWith(m.tier));
  if (!t) return;
  const check = (cycle, c) => {
    const envVal = process.env[c.env] || '';
    const expectedUrl = envVal || c.url;
    if (t[cycle].url !== expectedUrl) { console.log(`FAIL: ${m.tier} ${cycle} URL mismatch`); ok = false; }
    if (t[cycle].url === c.shortUrl) { console.log(`FAIL: ${m.tier} ${cycle} URL must be canonical checkout, not short link`); ok = false; }
    if (t[cycle].shortUrl !== c.shortUrl) { console.log(`FAIL: ${m.tier} ${cycle} shortUrl mismatch`); ok = false; }
    const envPid = process.env[c.env.replace('URL', 'PID')] || '';
    if (t.productIds[cycle] !== (envPid || c.pid)) { console.log(`FAIL: ${m.tier} ${cycle} PID mismatch`); ok = false; }
  };
  check('monthly', m.monthly);
  check('annual', m.annual);
});

if (!ADDONS || ADDONS.length < 3 || !ADDONS.some(a => a.name === 'Enterprise Intelligence')) {
  console.log('FAIL: missing add-ons catalog'); ok = false;
}

// ---- Sentinel separation: no Sentinel pricing inside the DealMaker catalog ----
const serialized = JSON.stringify(PRICING);
if (serialized.includes(SENTINEL_PID)) {
  console.log('FAIL: Sentinel Dodo product id leaks into DealMaker pricing'); ok = false;
}
if (/\\?$690/.test(serialized) || serialized.includes('$690')) {
  console.log('FAIL: Sentinel $690 pricing must not exist in DealMaker pricing'); ok = false;
}
if (PRICING.SENTINEL) {
  console.log('FAIL: SENTINEL pricing export must not exist in DealMaker config'); ok = false;
}
if (PRICING.SENTINEL_URL !== SENTINEL_URL) {
  console.log('FAIL: SENTINEL_URL cross-link mismatch'); ok = false;
}
if (!/^https:\/\/sentinel\./.test(PRICING.SENTINEL_URL || '') ||
    (PRICING.SENTINEL_URL || '').includes('checkout.dodopayments.com') ||
    (PRICING.SENTINEL_URL || '').includes('dodo.pe') ||
    (PRICING.SENTINEL_URL || '').includes('#')) {
  console.log('FAIL: SENTINEL_URL must be a plain external cross-link, not a checkout'); ok = false;
}

const text = formatPricingText();
const buttons = pricingButtons().inline_keyboard;

TIER_NAMES.forEach(name => {
  if (!text.includes(name)) { console.log(`FAIL: formatted text missing ${name}`); ok = false; }
});
if (!text.includes('Add-ons') || !text.includes('Enterprise Intelligence')) {
  console.log('FAIL: formatted text missing add-ons'); ok = false;
}
if (text.includes(SENTINEL_PID) || text.includes('$690')) {
  console.log('FAIL: formatted text must not carry Sentinel pricing'); ok = false;
}

const flatButtons = buttons.flat();
CANONICAL.forEach(m => {
  ['monthly', 'annual'].forEach(cycle => {
    if (!flatButtons.some(b => b.url === m[cycle].url)) {
      console.log(`FAIL: pricing buttons missing ${m.tier} ${cycle} checkout`); ok = false;
    }
  });
});
if (flatButtons.some(b => b.url.includes(SENTINEL_PID))) {
  console.log('FAIL: pricing buttons must not carry a Sentinel checkout'); ok = false;
}
buttons.forEach(row => {
  if (row.length > 2 || row.some(b => !/^https:\/\//.test(b.url))) {
    console.log('FAIL: malformed pricing button row'); ok = false;
  }
});

console.log(ok ? 'ALL PRICING CHECKS PASS' : 'PRICING CHECKS FAILED');
if (!ok) process.exit(1);

PRICING.forEach(t => console.log(`${t.tier}: monthly ${t.monthly.price} | annual ${t.annual.price}`));
console.log(`Sentinel: external cross-link ${PRICING.SENTINEL_URL}`);
