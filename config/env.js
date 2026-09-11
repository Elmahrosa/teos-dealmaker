// config/env.js — fail-fast environment validation.
//
// Contract (see .env.example):
//   - Tests never validate. tests/run-all.js forces NODE_ENV=test so the suite
//     runs against a deliberately empty environment; every feature already
//     fails closed on its own when keys are missing.
//   - A live deployment requires the identity + repository + founder keys.
//     "Production" means NODE_ENV=production OR TEOS_MODE=LIVE (the documented
//     Railway/Hostinger contract in .env.example). Fail at boot and list only
//     the MISSING variable NAMES — never echo a value.
//   - Feature secrets are only required when the switch that gates the feature
//     is actually on (e.g. OUTREACH_ENABLED=true => RESEND_API_KEY). Unset
//     switches stay optional, exactly as documented, in every environment.
//   - DATABASE_URL is mandatory in production so a live bot can never silently
//     fall back to the in-memory adapter.
'use strict';

function env(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() !== '';
}

function isProduction() {
  return process.env.NODE_ENV === 'production' || process.env.TEOS_MODE === 'LIVE';
}

function missing(required) {
  return required.filter(name => !env(name));
}

const REQUIRED_LIVE = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ADMIN_IDS',
  'TEOS_FOUNDER_TELEGRAM_ID',
  'DATABASE_URL'
];

// The two audit key forms are alternatives: the scoped map is preferred, the
// legacy root key is accepted. A live founder/ops console is dead without one.
const AUDIT_KEY_ONE_OF = ['AUDIT_API_KEY', 'AUDIT_API_KEYS'];

// Feature-gated secrets: only enforced when the gating switch is explicitly
// enabled, so disabled features never block startup in any environment.
const FEATURE_REQUIREMENTS = [
  { gate: 'OUTREACH_ENABLED', required: ['RESEND_API_KEY', 'FOUNDER_REPORT_EMAIL'] },
  { gate: 'MCP_ENABLED', required: ['MCP_ENDPOINT', 'MCP_API_KEY'] }
];

function missingFeatureVars() {
  const out = [];
  for (const rule of FEATURE_REQUIREMENTS) {
    if (String(process.env[rule.gate]) === 'true') {
      out.push(...missing(rule.required));
    }
  }
  return out;
}

// Throws an Error naming only the missing variables. Never returns values.
function assertEnv() {
  if (process.env.NODE_ENV === 'test') {
    return { ok: true, mode: 'test', checks: { required: 0, featureGated: 0 } };
  }

  const problems = [];
  if (isProduction()) {
    problems.push(...missing(REQUIRED_LIVE));
    if (!env(AUDIT_KEY_ONE_OF[0]) && !env(AUDIT_KEY_ONE_OF[1])) {
      problems.push(AUDIT_KEY_ONE_OF.join(' or '));
    }
  }
  const featureProblems = missingFeatureVars();
  problems.push(...featureProblems);

  if (problems.length > 0) {
    const reason = new Error(
      isProduction()
        ? '[env] Fatal: production environment is missing required configuration.\n' +
          'Missing: ' + problems.join(', ') + '\n' +
          'See .env.example for the documented defaults. No secret values were read.'
        : '[env] Fatal: enabled feature is missing its required configuration.\n' +
          'Missing: ' + problems.join(', ') + '\n' +
          'Set the switch or the missing variable per .env.example. No secret values were read.'
    );
    reason.code = 'ENV_VALIDATION_FAILED';
    reason.missing = problems;
    throw reason;
  }

  return {
    ok: true,
    mode: isProduction() ? 'production' : 'development',
    checks: { required: isProduction() ? REQUIRED_LIVE.length : 0, featureGated: featureProblems.length }
  };
}

module.exports = { assertEnv, env, isProduction };
