const fs = require('fs');
const path = require('path');
const { createPgAdapter, createMemoryAdapter } = require('./adapter');
const { createRepos, forWorkspace } = require('./repos');

let pool = null;
let adapter = null;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set. Cannot connect to PostgreSQL.');
    }
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

async function createTables() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  return getPool().query(schema);
}

module.exports = {
  getPool,
  getAdapter,
  createTables,
  createPgAdapter,
  createMemoryAdapter,
  createRepos,
  forWorkspace
};
