// tests/test-phase25-dry.js
// Phase 2.5 Stabilization — DRY mode pass.
// In-memory adapter, no provider keys. Proves the full bot workflow runs with
// zero regressions through the refactored services/workforce and
// services/mission-controller layers.

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.TELEGRAM_ADMIN_IDS = '7700001';
process.env.TEOS_FOUNDER_TELEGRAM_ID = '7700001';

const { runWorkflow } = require('./phase25-scenario');

(async () => {
  const result = await runWorkflow({ mode: 'DRY' });
  console.log(`\n\u2713 Phase 2.5 DRY pass (${result.checks} assertions passed)`);
  process.exit(0);
})().catch(err => {
  console.error('\u2717 Phase 2.5 DRY pass failed:', err.message);
  process.exit(1);
});
