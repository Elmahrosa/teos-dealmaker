const { TABLES } = require('./tables');
const { buildPoolConfig } = require('./pool-config');

const JSONB_COLUMNS = new Set([
  'subscriptions.refund_eligibility',
  'audit_trail.details',
  'agent_runs.input',
  'agent_runs.output',
  'plan_steps.depends_on',
  'plan_steps.review',
  'plan_steps.approval',
  'workspace_memory.value',
  'knowledge_documents.metadata',
  'integration_connections.config',
  'plans.metrics'
]);

function sanitize(table, row) {
  const allowed = new Set(TABLES[table].columns);
  const clean = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (allowed.has(key)) clean[key] = value;
  }
  return clean;
}

function hasTimestamps(table) {
  return Boolean(TABLES[table].timestamps);
}

function serialize(value, table, column) {
  if (value === null || value === undefined) return value;
  if (JSONB_COLUMNS.has(`${table}.${column}`)) return JSON.stringify(value);
  return typeof value === 'object' ? JSON.stringify(value) : value;
}

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function normalizeRow(row) {
  if (!row) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

function createPgAdapter() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set. Cannot connect to PostgreSQL.');
  }
  const { Pool } = require('pg');
  const pool = new Pool(buildPoolConfig());
  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
  });

  async function insert(table, row) {
    const clean = sanitize(table, row);
    const cols = Object.keys(clean);
    const values = cols.map(c => serialize(clean[c], table, c));
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const res = await pool.query(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return normalizeRow(res.rows[0] || null);
  }

  function buildWhere(table, where) {
    const keys = Object.keys(where || {});
    const clause = keys.length
      ? ` WHERE ${keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ')}`
      : '';
    return { clause, params: keys.map(k => serialize(where[k], table, k)) };
  }

  async function find(table, where, opts) {
    const o = opts || {};
    const { clause, params } = buildWhere(table, where);
    const orderCol = ['id', 'created_at', 'updated_at', 'timestamp', 'started_at', 'stage'].includes(o.orderBy)
      ? o.orderBy
      : (table === 'workspace_members' ? 'workspace_id' : 'id');
    const order = o.order === 'desc' ? 'DESC' : 'ASC';
    let sql = `SELECT * FROM ${table}${clause} ORDER BY ${orderCol} ${order}`;
    if (Number.isInteger(o.limit) && o.limit > 0) sql += ` LIMIT ${o.limit}`;
    if (Number.isInteger(o.offset) && o.offset > 0) sql += ` OFFSET ${o.offset}`;
    const res = await pool.query(sql, params);
    return res.rows.map(normalizeRow);
  }

  async function findOne(table, where) {
    const { clause, params } = buildWhere(table, where);
    const res = await pool.query(`SELECT * FROM ${table}${clause} LIMIT 1`, params);
    return normalizeRow(res.rows[0] || null);
  }

  async function update(table, where, changes) {
    const clean = sanitize(table, changes);
    const keys = Object.keys(clean);
    const whereKeys = Object.keys(where || {});
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const whereClause = whereKeys.map((k, i) => `${k} = $${keys.length + i + 1}`).join(' AND ');
    const params = [...keys.map(k => serialize(clean[k], table, k)), ...whereKeys.map(k => serialize(where[k], table, k))];
    const res = await pool.query(
      `UPDATE ${table} SET ${setClause} WHERE ${whereClause} RETURNING *`,
      params
    );
    return normalizeRow(res.rows[0] || null);
  }

  async function count(table, where) {
    const { clause, params } = buildWhere(table, where);
    const res = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}${clause}`, params);
    return res.rows[0].count;
  }

  async function del(table, where) {
    const { clause, params } = buildWhere(table, where);
    const res = await pool.query(`DELETE FROM ${table}${clause}`, params);
    return res.rowCount;
  }

  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return { kind: 'pg', insert, find, findOne, update, count, delete: del, transaction };
}

function createMemoryAdapter() {
  const tables = {};
  for (const table of Object.keys(TABLES)) tables[table] = [];
  let seq = 1;
  const now = () => new Date().toISOString();

  function insert(table, row) {
    const clean = sanitize(table, row);
    const rec = { id: seq++, ...clean };
    if (hasTimestamps(table)) {
      rec.created_at = now();
      rec.updated_at = rec.created_at;
    }
    tables[table].push(rec);
    return { ...rec };
  }

  function find(table, where, opts) {
    const o = opts || {};
    let rows = tables[table].filter(r => matches(r, where || {}));
    const orderCol = o.orderBy || 'id';
    const direction = o.order === 'desc' ? -1 : 1;
    rows = rows.slice().sort((a, b) => {
      const av = a[orderCol];
      const bv = b[orderCol];
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * direction;
    });
    if (Number.isInteger(o.offset) && o.offset > 0) rows = rows.slice(o.offset);
    if (Number.isInteger(o.limit) && o.limit > 0) rows = rows.slice(0, o.limit);
    return rows.map(r => ({ ...r }));
  }

  function findOne(table, where) {
    const row = tables[table].find(r => matches(r, where || {}));
    return row ? { ...row } : null;
  }

  function update(table, where, changes) {
    const clean = sanitize(table, changes);
    const row = tables[table].find(r => matches(r, where || {}));
    if (!row) return null;
    Object.assign(row, clean);
    if (hasTimestamps(table)) row.updated_at = now();
    return { ...row };
  }

  function count(table, where) {
    return tables[table].filter(r => matches(r, where || {})).length;
  }

  function del(table, where) {
    const before = tables[table].length;
    tables[table] = tables[table].filter(r => !matches(r, where || {}));
    return before - tables[table].length;
  }

  async function transaction(fn) {
    return fn(null);
  }

  return { kind: 'memory', insert, find, findOne, update, count, delete: del, transaction };
}

module.exports = { createPgAdapter, createMemoryAdapter };
