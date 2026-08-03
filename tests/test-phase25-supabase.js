// tests/test-phase25-supabase.js
// Phase 2.5 Stabilization — SUPABASE (PostgreSQL) pass.
//
// Runs the identical workflow scenario against the real PostgreSQL adapter.
// Requires a connection string:
//   DATABASE_URL=postgres://... node tests/test-phase25-supabase.js
// or run through npm:   npm test -- (only when DATABASE_URL is exported)
//
// When DATABASE_URL is not set this suite skips cleanly (exit 0) so the
// default test suite stays infrastructure-free. Every run uses random telegram
// ids so the test is re-runnable against the same database.

const fs = require('fs');
const path = require('path');

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('  - phase25-supabase skipped (DATABASE_URL not set)');
    process.exit(0);
  }

  process.env.TELEGRAM_ADMIN_IDS = '7700001';
  process.env.TEOS_FOUNDER_TELEGRAM_ID = '7700001';

  const db = require('../db');
  const founderId = 7700000 + Math.floor(Math.random() * 900000);
  const newcomerId = founderId + 1;

  await db.createTables();
  const migration = fs.readFileSync(path.join(__dirname, '../db/migrations/001_fix_fk_ordering.sql'), 'utf8');
  await db.getPool().query(migration);

  const { runWorkflow } = require('./phase25-scenario');
  const result = await runWorkflow({ mode: 'DRY', founderId, newcomerId });

  const tables = await db.getPool().query(
    'SELECT tablename FROM pg_tables WHERE schemaname = \'public\''
  );
  const count = await db.getPool().query(
    'SELECT COUNT(*)::int AS n FROM workspaces'
  );
  console.log(`\n\u2713 Phase 2.5 SUPABASE pass (${result.checks} assertions passed)`);
  console.log(`  postgres schema: ${tables.rows.length} tables · ${count.rows[0].n} workspaces`);
  await db.getPool().end();
  process.exit(0);
})().catch(err => {
  console.error('\u2717 Phase 2.5 SUPABASE pass failed:', err.message);
  if (process.env.DATABASE_URL) {
    const db = require('../db');
    db.getPool().end().catch(() => {});
  }
  process.exit(1);
});
