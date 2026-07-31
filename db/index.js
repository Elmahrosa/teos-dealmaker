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

async function createDeal({ companyName, status = 'PROSPECTING', currentAgent = null, dealValue = null }) {
  const res = await query(
    `INSERT INTO deals (company_name, status, current_agent, deal_value)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [companyName, status, currentAgent, dealValue]
  );
  return res.rows[0];
}

async function updateDealStatus(id, status) {
  const res = await query(
    `UPDATE deals SET status = $2 WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return res.rows[0];
}

async function getDeals() {
  const res = await query(`SELECT * FROM deals ORDER BY id`);
  return res.rows;
}

module.exports = { query, getPool, createTables, createDeal, updateDealStatus, getDeals };
