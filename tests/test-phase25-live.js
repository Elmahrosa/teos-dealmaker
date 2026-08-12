// tests/test-phase25-live.js
// Phase 2.5 Stabilization — LIVE mode pass.
// In-memory adapter, providers are configured but unauthenticated (no API keys
// in .env), so every provider call is simulated with real routing/fallback
// logic — the "mock if appropriate" path. Proves provider switching, policy
// routing, usage ledgering and the LIVE/DRY mode machine end to end.

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.TELEGRAM_ADMIN_IDS = '7700001';
process.env.TEOS_FOUNDER_TELEGRAM_ID = '7700001';

const { runWorkflow } = require('./phase25-scenario');

(async () => {
  const result = await runWorkflow({ mode: 'LIVE' });
  console.log(`\n\u2713 Phase 2.5 LIVE pass (${result.checks} assertions passed)`);
  process.exit(0);
})().catch(err => {
  console.error('\u2717 Phase 2.5 LIVE pass failed:', err.message);
  process.exit(1);
});

