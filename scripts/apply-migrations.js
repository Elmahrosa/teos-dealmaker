// scripts/apply-migrations.js
// Forward-only migration runner for TEOS DealMaker. Applies every SQL file in
// db/migrations/ in filename order, once each, tracking applied files in a
// schema_migrations table so re-runs are no-ops.
//
// Every migration is written to be idempotent, so this is safe to re-run even
// on a database where migrations were previously applied by hand.
//
// Usage:
//   node scripts/apply-migrations.js             # apply against DATABASE_URL
//   node scripts/apply-migrations.js --dry-run   # list pending files, write nothing
//
// DATABASE_URL must be present in the environment (or .env). The secret is
// never printed.
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(root, 'db', 'migrations');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const tag = dryRun ? '[migrate:dry-run]' : '[migrate]';

  if (!process.env.DATABASE_URL) {
    console.error(`${tag} DATABASE_URL is not set — cannot connect. Nothing changed.`);
    process.exit(1);
  }

  const { getPool } = require('../db');
  const pool = getPool();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (!files.length) {
    console.log(`${tag} no migration files found in ${MIGRATIONS_DIR}`);
    return;
  }

  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (filename VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP)'
  );

  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));
  const pending = files.filter((f) => !applied.has(f));

  if (!pending.length) {
    console.log(`${tag} schema up to date — ${applied.size} migration(s) already applied, none pending.`);
    return;
  }

  console.log(`${tag} ${pending.length} pending migration(s): ${pending.join(', ')}`);

  for (const file of pending) {
    if (dryRun) {
      console.log(`${tag} [dry-run] would apply ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`${tag} applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }

  console.log(`${tag} complete. ${dryRun ? 'dry-run — nothing written.' : 'All pending migrations applied.'}`);
}

main().catch((err) => {
  console.error('[migrate] failed:', err.message);
  process.exit(1);
});
