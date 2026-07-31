const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set. Cannot connect to PostgreSQL.');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL
      // ssl: { rejectUnauthorized: false } // enable for managed providers
    });
    pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
      process.exit(-1);
    });
  }
  return pool;
}

function query(text, params) {
  return getPool().query(text, params);
}

async function createTables() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  return getPool().query(schema);
}

module.exports = { query, getPool, createTables };
