const fs = require('fs');
const path = require('path');
const { createPgAdapter, createMemoryAdapter } = require('./adapter');
const { createRepos, forWorkspace } = require('./repos');
const { buildPoolConfig } = require('./pool-config');

let pool = null;
let adapter = null;

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
  if (!adapter) {
    adapter = createPgAdapter();
  }
  return adapter;
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
  getDb,
  isSorEnabled,
  createTables,
  createPgAdapter,
  createMemoryAdapter,
  createRepos,
  forWorkspace
};
