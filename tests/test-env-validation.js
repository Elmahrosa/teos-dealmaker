// tests/test-env-validation.js
//
// Regression test for config/env.js fail-fast validation:
//   - tests (NODE_ENV=test) are exempt — the suite runs on an empty env
//   - production (NODE_ENV=production or TEOS_MODE=LIVE) requires the identity
//     + repository + founder keys and at least one audit key form
//   - dev/DRY is free to run without DATABASE_URL (memory is allowed there)
//   - feature secrets are required only when the gating switch is enabled
//   - thrown messages list variable NAMES and never leak values
'use strict';

const assert = require('assert');
const { assertEnv } = require('../config/env');

let passed = 0;
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); passed++; };
const tru = (v, msg) => { assert.ok(v, msg); passed++; };

const TOUCHED = [
  'NODE_ENV', 'TEOS_MODE', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_IDS',
  'TEOS_FOUNDER_TELEGRAM_ID', 'DATABASE_URL', 'AUDIT_API_KEY',
  'AUDIT_API_KEYS', 'OUTREACH_ENABLED', 'RESEND_API_KEY',
  'FOUNDER_REPORT_EMAIL', 'MCP_ENABLED', 'MCP_ENDPOINT', 'MCP_API_KEY'
];
const saved = {};
for (const k of TOUCHED) saved[k] = process.env[k];
function restore() {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

(async () => {
  try {
    // 1. Test environment is always exempt.
    process.env.NODE_ENV = 'test';
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.DATABASE_URL;
    const r = assertEnv();
    eq(r.mode, 'test', 'test env returns mode=test and never throws');
    restore();

    // 2. Production without the repository fails, naming only DATABASE_URL.
    process.env.NODE_ENV = 'production';
    process.env.TELEGRAM_BOT_TOKEN = '111:ABC';
    process.env.TELEGRAM_ADMIN_IDS = '123';
    process.env.TEOS_FOUNDER_TELEGRAM_ID = '123';
    process.env.AUDIT_API_KEY = 'root-key';
    delete process.env.DATABASE_URL;
    let err = null;
    try { assertEnv(); } catch (e) { err = e; }
    tru(err, 'production without DATABASE_URL throws');
    tru(err.message.includes('DATABASE_URL'), 'error names the missing variable');
    tru(err.message.includes('TELEGRAM_BOT_TOKEN') === false, 'present variables are not reported missing');
    tru(!err.message.includes('111:ABC') && !err.message.includes('root-key'), 'error never leaks secret values');
    eq(err.code, 'ENV_VALIDATION_FAILED', 'error carries a stable code');

    // 3. Production with every key (scoped audit map counts as the audit key).
    process.env.DATABASE_URL = 'postgres://u:p@h/db';
    delete process.env.AUDIT_API_KEY;
    process.env.AUDIT_API_KEYS = '{"founder_console":"k"}';
    const okProd = assertEnv();
    eq(okProd.mode, 'production', 'complete production env passes');
    eq(okProd.checks.required, 4, 'four live-required vars were checked');

    // 4. Dev/DRY may run memory-mode; DATABASE_URL is not demanded.
    delete process.env.NODE_ENV;
    process.env.TEOS_MODE = 'DRY';
    delete process.env.DATABASE_URL;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const okDev = assertEnv();
    eq(okDev.mode, 'development', 'DRY without DATABASE_URL passes (memory allowed in dev)');

    // 5. TEOS_MODE=LIVE is production even when NODE_ENV is unset.
    process.env.TEOS_MODE = 'LIVE';
    delete process.env.DATABASE_URL;
    err = null;
    try { assertEnv(); } catch (e) { err = e; }
    tru(err, 'TEOS_MODE=LIVE without DATABASE_URL throws');
    tru(err.message.includes('DATABASE_URL'), 'LIVE mode is treated as production');

    // 6. Feature-secret rules fire only when the gate is on.
    process.env.TEOS_MODE = 'DRY';
    process.env.OUTREACH_ENABLED = 'true';
    delete process.env.RESEND_API_KEY;
    process.env.FOUNDER_REPORT_EMAIL = 'a@b.c';
    err = null;
    try { assertEnv(); } catch (e) { err = e; }
    tru(err, 'OUTREACH_ENABLED=true without RESEND_API_KEY throws');
    tru(err.message.includes('RESEND_API_KEY'), 'error names the feature-gated variable');
    tru(!err.message.includes('FOUNDER_REPORT_EMAIL'), 'satisfied feature vars are not demanded');

    process.env.RESEND_API_KEY = 're_123';
    const okOut = assertEnv();
    eq(okOut.mode, 'development', 'gated feature satisfied in dev passes');

    // 7. Disabled gates never block startup.
    process.env.OUTREACH_ENABLED = 'false';
    delete process.env.RESEND_API_KEY;
    assertEnv();
    tru(true, 'disabled feature with no secret passes');

    // 8. MCP gate behaves identically.
    process.env.MCP_ENABLED = 'true';
    delete process.env.MCP_ENDPOINT;
    process.env.MCP_API_KEY = 'sk';
    err = null;
    try { assertEnv(); } catch (e) { err = e; }
    tru(err && err.message.includes('MCP_ENDPOINT'), 'MCP_ENABLED=true requires MCP_ENDPOINT');
  } finally {
    restore();
  }

  console.log(`\n\u2713 env validation (${passed} assertions passed)`);
  console.log('  test-exempt · prod fail-fast names-only · LIVE==production · feature-gated secrets');
  process.exit(0);
})().catch(e => {
  console.error('TEST FAILURE:', e.message || e);
  process.exit(1);
});
