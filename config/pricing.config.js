'use strict';

// Commerce catalog for the TEOS DealMaker platform. The checkout URLs below
// are the canonical founder-provided Dodo payment links (real, publicly
// reachable checkout pages — never placeholders). Environment overrides
// (DODO_*) let staging swap in test products without touching the source of
// truth. Enterprise is custom-priced with no public checkout.
//
// Security note: these are PUBLIC product IDs and checkout URLs — safe to
// embed in the landing page. Never put API credentials in this file.

const env = process.env;

const PRICING = [
  {
    tier: '🚀 Solo',
    tagline: 'For founders and solo teams',
    monthly: {
      price: '$99.00',
      priceCents: 9900,
      url: env.DODO_STARTER_MONTHLY_URL || 'https://checkout.dodopayments.com/buy/pdt_0NkdQVk7ahfyz0VSoTGip',
      shortUrl: 'https://dodo.pe/teos-dealmaker-solo-monthly-13644952'
    },
    annual: {
      price: '$950.00',
      priceCents: 95000,
      url: env.DODO_STARTER_ANNUAL_URL || 'https://checkout.dodopayments.com/buy/pdt_0NkdQW1mGZrFIxz9dm7eZ',
      shortUrl: 'https://dodo.pe/teos-dealmaker-solo-annual-13644952'
    },
    productIds: {
      monthly: env.DODO_STARTER_MONTHLY_PID || 'pdt_0NkdQVk7ahfyz0VSoTGip',
      annual: env.DODO_STARTER_ANNUAL_PID || 'pdt_0NkdQW1mGZrFIxz9dm7eZ'
    },
    features: [
      '1 workspace',
      'Mission Controller with a 13-agent AI workforce',
      'Core agent capabilities',
      'Community support'
    ]
  },
  {
    tier: '⚡ Growth',
    tagline: 'For growing revenue teams',
    monthly: {
      price: '$299.00',
      priceCents: 29900,
      url: env.DODO_GROWTH_MONTHLY_URL || 'https://checkout.dodopayments.com/buy/pdt_0NkdQWCpT2SbojpuscwVI',
      shortUrl: 'https://dodo.pe/teos-dealmaker-growth-monthly-13644952'
    },
    annual: {
      price: '$2,990.00',
      priceCents: 299000,
      url: env.DODO_GROWTH_ANNUAL_URL || 'https://checkout.dodopayments.com/buy/pdt_0NkdQWOkJWfbSa7qtCLZm',
      shortUrl: 'https://dodo.pe/teos-dealmaker-growth-annual-13644952'
    },
    productIds: {
      monthly: env.DODO_GROWTH_MONTHLY_PID || 'pdt_0NkdQWCpT2SbojpuscwVI',
      annual: env.DODO_GROWTH_ANNUAL_PID || 'pdt_0NkdQWOkJWfbSa7qtCLZm'
    },
    features: [
      '10 seats',
      'Civic Mixer + Sentinel Shield plugins',
      'Enterprise Knowledge Intelligence',
      'Email support'
    ]
  },
  {
    tier: '👑 Business',
    tagline: 'For revenue organizations',
    monthly: {
      price: '$999.00',
      priceCents: 99900,
      url: env.DODO_BUSINESS_MONTHLY_URL || 'https://checkout.dodopayments.com/buy/pdt_0NkdQWZ1Bkv413NqbbVFu',
      shortUrl: 'https://dodo.pe/teos-dealmaker-business-monthly-13644952'
    },
    annual: {
      price: '$9,990.00',
      priceCents: 999000,
      url: env.DODO_BUSINESS_ANNUAL_URL || 'https://checkout.dodopayments.com/buy/pdt_0NkdQWgxl0hJcb4skW8IK',
      shortUrl: 'https://dodo.pe/teos-dealmaker-business-annual-13644952'
    },
    productIds: {
      monthly: env.DODO_BUSINESS_MONTHLY_PID || 'pdt_0NkdQWZ1Bkv413NqbbVFu',
      annual: env.DODO_BUSINESS_ANNUAL_PID || 'pdt_0NkdQWgxl0hJcb4skW8IK'
    },
    features: [
      '25 seats',
      'Third-party plugin installs',
      'All platform add-ons',
      'Priority support'
    ]
  },
  {
    tier: '🏛️ Enterprise',
    tagline: 'For large and sovereign organizations',
    monthly: { price: 'Custom', priceCents: null, url: '', shortUrl: '' },
    annual: { price: 'Custom', priceCents: null, url: '', shortUrl: '' },
    productIds: { monthly: '', annual: '' },
    custom: true,
    features: [
      'Unlimited workspaces',
      'Unlimited missions',
      'Custom deployment options (COMING SOON)',
      'Sentinel governance at scale',
      'Direct access to the founding team'
    ]
  }
];

const ADDONS = [
  { id: 'sentinel', name: 'Sentinel Governance', description: 'Policy enforcement, prompt security, and continuous audit across every capability.' },
  { id: 'intelligence', name: 'Enterprise Intelligence', description: 'RAG knowledge base with source-attributed answers.' },
  { id: 'connectors', name: 'CRM Connectors', description: 'Salesforce, HubSpot, Microsoft 365, and Google Workspace connectors (COMING SOON).' },
  { id: 'models', name: 'Premium AI Models', description: 'Access to frontier reasoning models.' },
  { id: 'support', name: 'Dedicated Support', description: 'Priority support from the founding team.' }
];

// TEOS Sentinel is a SEPARATE product with its own pricing page — it must
// never be sold from the DealMaker commerce surface. This is a plain external
// cross-link, not a checkout URL and not a price.
const SENTINEL_URL = 'https://sentinel.teosegypt.com';

function pricingWords(lang) {
  return lang === 'ar'
    ? { monthly: 'شهرياً', annual: 'سنوياً', pricing: 'الأسعار', addons: 'إضافات المنصة' }
    : { monthly: 'Monthly', annual: 'Annual', pricing: 'Pricing', addons: 'Add-ons' };
}

function formatPricingText(lang) {
  const w = pricingWords(lang);
  return [
    `💳 <b>${w.pricing}</b>`,
    '',
    ...PRICING.flatMap(t => [
      t.tier,
      `  ${w.monthly} ${t.monthly.price}` + (t.monthly.url ? ` — ${t.monthly.url}` : ''),
      `  ${w.annual} ${t.annual.price}` + (t.annual.url ? ` — ${t.annual.url}` : ''),
      ''
    ]),
    `🧩 <b>${w.addons}</b>`,
    ...ADDONS.map(a => `  ${a.name} — ${a.description}`)
  ].join('\n');
}

function pricingButtons(lang) {
  const w = pricingWords(lang);
  return {
    inline_keyboard: PRICING.flatMap(t => {
      const row = [];
      if (t.monthly.url) row.push({ text: `${t.tier} ${w.monthly} ${t.monthly.price}`, url: t.monthly.url });
      if (t.annual.url) row.push({ text: `${t.tier} ${w.annual} ${t.annual.price}`, url: t.annual.url });
      return row.length ? [row] : [];
    })
  };
}

module.exports = PRICING;
module.exports.formatPricingText = formatPricingText;
module.exports.pricingButtons = pricingButtons;
module.exports.ADDONS = ADDONS;
module.exports.SENTINEL_URL = SENTINEL_URL;
