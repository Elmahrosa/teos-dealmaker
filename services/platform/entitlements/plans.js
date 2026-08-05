// services/platform/entitlements/plans.js
// Entitlement plan catalog. The only commercial plans are Solo, Growth,
// Business, and Enterprise. 'founder' is an internal lifetime plan for the
// platform owner and is never offered to customers. A limit of 0 means
// unlimited. capabilityScopes gate what a tenant may exercise: 'core'
// (builtin gateway tools), 'plugin' (first-party plugins), 'custom'
// (third-party plugin installs), '*' (everything).
'use strict';

const PLANS = {
  founder: {
    tier: 'Founder',
    seats: 0,
    agents: 0,
    capabilityScopes: ['*'],
    plugins: ['*'],
    usage: { cost_cents_month: 0, token_month: 0 },
    customPlugins: true
  },
  solo: {
    tier: 'Solo',
    seats: 3,
    agents: 13,
    capabilityScopes: ['core', 'plugin'],
    plugins: ['civic-mixer', 'sentinel'],
    usage: { cost_cents_month: 5000, token_month: 2000000 },
    customPlugins: false
  },
  growth: {
    tier: 'Growth',
    seats: 10,
    agents: 13,
    capabilityScopes: ['core', 'plugin'],
    plugins: ['civic-mixer', 'sentinel'],
    usage: { cost_cents_month: 15000, token_month: 10000000 },
    customPlugins: false
  },
  corporate: {
    tier: 'Business',
    seats: 25,
    agents: 13,
    capabilityScopes: ['core', 'plugin', 'custom'],
    plugins: ['civic-mixer', 'sentinel'],
    usage: { cost_cents_month: 60000, token_month: 50000000 },
    customPlugins: true
  },
  enterprise: {
    tier: 'Enterprise',
    seats: 0,
    agents: 0,
    capabilityScopes: ['*'],
    plugins: ['*'],
    usage: { cost_cents_month: 0, token_month: 0 },
    customPlugins: true
  }
};

const LIMIT_UNLIMITED = 0;

function get(plan) {
  return PLANS[plan] || PLANS.solo;
}

function list() {
  return Object.keys(PLANS).map((id) => Object.assign({ id }, PLANS[id]));
}

module.exports = { PLANS, LIMIT_UNLIMITED, get, list };
