'use strict';

// Commerce catalog for the TEOS DealMaker platform. Checkout URLs and Dodo
// product ids come from the environment (DODO_*) so staging and production can
// differ; when unset, tiers render with prices but no checkout link.
// Enterprise is custom-priced with no public checkout.

const env = process.env;

const PRICING = [
  {
    tier: '🚀 Solo',
    tagline: 'For founders and solo teams',
    monthly: { price: '$79.00', url: env.DODO_STARTER_MONTHLY_URL || '' },
    annual: { price: '$790.00', url: env.DODO_STARTER_ANNUAL_URL || '' },
    productIds: {
      monthly: env.DODO_STARTER_MONTHLY_PID || '',
      annual: env.DODO_STARTER_ANNUAL_PID || ''
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
    monthly: { price: '$249.00', url: env.DODO_GROWTH_MONTHLY_URL || '' },
    annual: { price: '$2,490.00', url: env.DODO_GROWTH_ANNUAL_URL || '' },
    productIds: {
      monthly: env.DODO_GROWTH_MONTHLY_PID || '',
      annual: env.DODO_GROWTH_ANNUAL_PID || ''
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
    monthly: { price: '$699.00', url: env.DODO_BUSINESS_MONTHLY_URL || '' },
    annual: { price: '$6,990.00', url: env.DODO_BUSINESS_ANNUAL_URL || '' },
    productIds: {
      monthly: env.DODO_BUSINESS_MONTHLY_PID || '',
      annual: env.DODO_BUSINESS_ANNUAL_PID || ''
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
    monthly: { price: 'Custom', url: env.DODO_ENTERPRISE_URL || '' },
    annual: { price: 'Custom', url: env.DODO_ENTERPRISE_URL || '' },
    productIds: { monthly: '', annual: '' },
    custom: true,
    features: [
      'Unlimited workspaces',
      'Unlimited missions',
      'Private deployment',
      'Sentinel governance at scale',
      'Dedicated success engineer'
    ]
  }
];

const ADDONS = [
  { id: 'sentinel', name: 'Sentinel Governance', description: 'Policy enforcement, prompt security, and continuous audit across every capability.' },
  { id: 'intelligence', name: 'Enterprise Intelligence', description: 'RAG knowledge base with source-attributed answers.' },
  { id: 'connectors', name: 'CRM Connectors', description: 'Salesforce, HubSpot, Microsoft 365, and Google Workspace sync.' },
  { id: 'models', name: 'Premium AI Models', description: 'Access to frontier reasoning models.' },
  { id: 'support', name: 'Dedicated Support', description: 'Named engineer with priority SLAs.' }
];

function formatPricingText() {
  return [
    '💳 <b>Pricing</b>',
    '',
    ...PRICING.flatMap(t => [
      t.tier,
      `  Monthly ${t.monthly.price}` + (t.monthly.url ? ` — ${t.monthly.url}` : ''),
      `  Annual ${t.annual.price}` + (t.annual.url ? ` — ${t.annual.url}` : ''),
      ''
    ]),
    '🧩 <b>Add-ons</b>',
    ...ADDONS.map(a => `  ${a.name} — ${a.description}`)
  ].join('\n');
}

function pricingButtons() {
  return {
    inline_keyboard: PRICING.flatMap(t => {
      const row = [];
      if (t.monthly.url) row.push({ text: `${t.tier} Monthly ${t.monthly.price}`, url: t.monthly.url });
      if (t.annual.url) row.push({ text: `${t.tier} Annual ${t.annual.price}`, url: t.annual.url });
      return row.length ? [row] : [];
    })
  };
}

module.exports = PRICING;
module.exports.formatPricingText = formatPricingText;
module.exports.pricingButtons = pricingButtons;
module.exports.ADDONS = ADDONS;
