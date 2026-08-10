'use strict';

// Canonical product / capability configuration for TEOS DealMaker.
//
// This is the single source of truth shared by the landing page
// (server/landing.html), the web server (server/index.js), and the Telegram
// bot (bot/) so the product is described identically everywhere:
//   - product name, tagline, description, contact
//   - pricing (delegated to ./pricing.config.js — never duplicated here)
//   - mission lifecycle and governance terminology
//   - supported integrations (COMING SOON is the default status)
//   - Sentinel relationship (separate product, cross-link only)
//   - playground / demo behavior (simulated data only)
//
// Provider wording is deliberately provider-agnostic: the platform supports
// multiple LLM providers with automatic fallback chains (services/providers.js)
// and includes Anthropic Claude — it is not "built on" a single vendor and the
// Claude Partner Network badge implies no exclusive endorsement.

const PRICING = require('./pricing.config');

const env = process.env;

const PRODUCT = {
  name: 'TEOS DealMaker',
  shortName: 'DealMaker',
  tagline: 'Enterprise AI Revenue Operating System',
  description: 'Plan, approve, execute, and audit your entire revenue pipeline with a policy-governed 13-agent AI workforce, a Mission Controller, governed email, Dodo checkout, and a 24/7 outbound worker.',
  siteUrl: env.SITE_URL || 'https://dealmaker.elmahrosa.org',
  telegramBotUrl: env.TELEGRAM_BOT_URL || 'https://t.me/TeosEgypt_bot',
  botHandle: env.BOT_NAME || 'TeosEgypt_bot',
  contactEmail: env.PUBLIC_CONTACT_EMAIL || 'info@elmahrosa.org',
  founderReportEmail: env.FOUNDER_REPORT_EMAIL || env.FOUNDER_REPORT_TO || 'teosegy@gmail.com',

  // Providers: pluggable and provider-agnostic; multiple vendors with
  // automatic fallback chains. Verified in services/providers.js.
  providers: 'Pluggable, provider-agnostic: multiple LLM providers with automatic fallback chains, including Anthropic Claude.',

  capabilities: [
    'Mission Controller',
    '13-agent AI workforce',
    'Deal Intelligence',
    'Deal Simulation',
    'Governed email + 24/7 outbound worker',
    'Mission Reports',
    'Dodo checkout',
    'Sentinel governance / audit'
  ],

  // Lifecycle shown on the landing playground and mirrored by the bot.
  missionLifecycle: ['PLAN', 'ANALYZE', 'SIMULATE', 'APPROVE', 'EXECUTE', 'REPORT'],

  // Governance vocabulary: consequential external actions are policy-evaluated
  // and remain governed (no silent execution).
  governance: [
    { code: 'ALLOW', note: 'policy pass — action permitted and audited' },
    { code: 'WARN', note: 'policy pass with caution — surfaced for founder awareness' },
    { code: 'REVIEW', note: 'draft/risky action routed to a human review gate' },
    { code: 'BLOCK', note: 'policy deny — action never runs' }
  ],

  // Supported integrations. Anything without a live adapter stays COMING SOON.
  integrations: [
    { id: 'github', name: 'GitHub', status: 'COMING_SOON' },
    { id: 'slack', name: 'Slack', status: 'COMING_SOON' },
    { id: 'hubspot', name: 'HubSpot', status: 'COMING_SOON' },
    { id: 'salesforce', name: 'Salesforce', status: 'COMING_SOON' },
    { id: 'm365', name: 'Microsoft 365', status: 'COMING_SOON' },
    { id: 'gws', name: 'Google Workspace', status: 'COMING_SOON' }
  ],

  reports: {
    page: '/reports',
    api: '/api/reports/latest'
  },

  // TEOS Sentinel is a SEPARATE product. DealMaker only cross-links to it —
  // never a Sentinel price, Dodo product, or checkout inside DealMaker.
  sentinel: {
    name: 'TEOS Sentinel',
    url: PRICING.SENTINEL_URL,
    separate: true
  },

  // Playground / demo behavior. Everything in the demo is SIMULATED: the demo
  // never sends an external email, never creates a Dodo payment, never
  // contacts a prospect, and claims no real customer result.
  demo: {
    label: 'DEMO MODE — SIMULATED DATA',
    runCta: 'Run a Demo Mission',
    anchor: '#playground'
  }
};

function words(lang) {
  return lang === 'ar'
    ? {
      name: 'صانع الصفقات تيوس',
      tagline: 'نظام تشغيل الإيرادات المؤسسي بالذكاء الاصطناعي',
      comingSoon: 'قريباً',
      plans: 'الأسعار',
      playground: 'التجربة'
    }
    : {
      name: 'TEOS DealMaker',
      tagline: 'Enterprise AI Revenue Operating System',
      comingSoon: 'COMING SOON',
      plans: 'Plans',
      playground: 'Playground'
    };
}

function botProductCard(lang) {
  const w = words(lang);
  return [
    `${w.name} — ${w.tagline}`,
    '',
    ...PRODUCT.capabilities.map(c => `• ${c}`),
    '',
    `🛡 Governance: ${PRODUCT.governance.map(g => g.code).join(' / ')}`,
    `🚀 Open the playground: ${PRODUCT.siteUrl}${PRODUCT.demo.anchor}`,
    `🤖 Open in Telegram: ${PRODUCT.telegramBotUrl}`,
    `✉️ Contact: ${PRODUCT.contactEmail}`
  ].join('\n');
}

module.exports = { PRODUCT, words, botProductCard };
module.exports.PRODUCT = PRODUCT;
