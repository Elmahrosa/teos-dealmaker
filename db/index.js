const fs = require('fs');
const path = require('path');

let pool = null;

function getPool() {
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

module.exports = { getPool, query, createTables };
