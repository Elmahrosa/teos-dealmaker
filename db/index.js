const fs = require('fs');
const path = require('path');
const { createPgAdapter, createMemoryAdapter } = require('./adapter');
const { createRepos, forWorkspace } = require('./repos');
const { buildPoolConfig } = require('./pool-config');
const { isProduction } = require('../config/env');

let pool = null;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set. Cannot connect to PostgreSQL.');
    }
    const { Pool } = require('pg');
    pool = new Pool(buildPoolConfig());
    pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });
  }
  return pool;
}

function getAdapter() {
  if (process.env.DATABASE_URL) {
    return createPgAdapter();
  } else {
    throw new Error('DATABASE_URL environment variable is not set. Cannot connect to PostgreSQL.');
  }
}

// Single source of truth for adapter resolution with an explicit fallback
// policy. Production (NODE_ENV=production or TEOS_MODE=LIVE) NEVER silently
// degrades to the in-memory store: config/env.js already asserts DATABASE_URL
// at boot, and a DB that disappears mid-life surfaces here as a loud throw,
// not as a quiet demo adapter. Test/development may run memory-mode, with one
// explicit log line per process so nobody mistakes it for persistence.
let memoryAdapterWarned = false;
function memoryAdapter() {
  if (!memoryAdapterWarned) {
    memoryAdapterWarned = true;
    console.warn('[db] using in-memory adapter (no DATABASE_URL) — data is ephemeral. Allowed only in test/development.');
  }
  return createMemoryAdapter();
}

function resolveAdapter() {
  if (process.env.DATABASE_URL) return getAdapter();
  if (process.env.NODE_ENV === 'test' || !isProduction()) return memoryAdapter();
  throw new Error('DATABASE_URL environment variable is not set. Refusing to run production on the in-memory adapter.');
}

function isSorEnabled() {
  const raw = process.env.SOR_ENABLED !== undefined ? process.env.SOR_ENABLED : process.env.SOR_GATE;
  return raw !== undefined && raw !== '' && String(raw).toLowerCase() === 'true';
}

function getDb() {
  const a = getAdapter();
  return {
    adapter: a,
    pg: getPool(),
    repos: createRepos(a),
    mode: isSorEnabled() ? 'SOR' : 'LEGACY'
  };
}

async function createTables() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  return getPool().query(schema);
}

module.exports = {
  getPool,
  getAdapter,
  resolveAdapter,
  getDb,
  isSorEnabled,
  createTables,
  createPgAdapter,
  createMemoryAdapter,
  createRepos,
  forWorkspace
};
