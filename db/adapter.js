const { TABLES } = require('./tables');
const { buildPoolConfig } = require('./pool-config');
const { WIN_CAPABILITY, assertNotTerminal } = require('../services/dealLifecycle');

// Lifecycle guard at the adapter boundary: raw writes to deals may not set a
// won/closed state. Only repos.deals.closeWon() holds the capability.
function guardDeals(adapter) {
  const rawInsert = adapter.insert;
  const rawUpdate = adapter.update;
  return {
    ...adapter,
    insert(table, row, cap) {
      if (table === 'deals' && cap !== WIN_CAPABILITY) assertNotTerminal(row);
      return rawInsert(table, row);
    },
    update(table, where, changes, cap) {
      if (table === 'deals' && cap !== WIN_CAPABILITY) assertNotTerminal(changes);
      return rawUpdate(table, where, changes);
    }
  };
}

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
  'plans.metrics',
  'resend_events.payload',
  'mission_intakes.answers',
  'prospects.metadata',
  'founder_reports.metrics',
  'revenue_ops_state.payload'
]);

function sanitize(table, row) {
  const allowed = new Set(TABLES[table].columns);
  const clean = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (allowed.has(key)) clean[key] = value;
  }
  return clean;
}

// Where-clause keys are interpolated into SQL verbatim, so they must be
// validated against the schema. Fail loud on an unknown column rather than
// silently dropping (or worse, injecting) a filter. `id` and the timestamp
// columns are implicit in every physical table, so they are always allowed.
function assertWhere(table, where) {
  const allowed = new Set([...TABLES[table].columns, 'id', 'created_at', 'updated_at']);
  for (const key of Object.keys(where || {})) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown column "${key}" in where clause for table "${table}"`);
    }
  }
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

// Every pg Pool this process opens is registered so shutdown can close them all.
const openPools = new Set();
function registerPool(pool) { openPools.add(pool); return pool; }

// Close every registered pool, waiting for checked-out clients to be released.
// Bounded: after timeoutMs the result reports timedOut and the caller decides.
async function closeAllPools(timeoutMs = 5000) {
  const pools = [...openPools];
  if (!pools.length) return { closed: 0, timedOut: false };
  let timer;
  const deadline = new Promise(res => { timer = setTimeout(() => res('timeout'), timeoutMs); });
  const ending = Promise.allSettled(pools.map(p => p.end())).then(() => 'done');
  const r = await Promise.race([ending, deadline]);
  clearTimeout(timer);
  if (r === 'done') openPools.clear();
  return { closed: r === 'done' ? pools.length : 0, timedOut: r === 'timeout' };
}

function createPgAdapter() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set. Cannot connect to PostgreSQL.');
  }
  const { Pool } = require('pg');
  const pool = registerPool(new Pool(buildPoolConfig()));
  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
  });

  // Statement set bound to one executor: the shared pool, or a single client
  // inside a transaction (see withTransaction).
  function buildOps(q) {
    async function insert(table, row) {
      const clean = sanitize(table, row);
      const cols = Object.keys(clean);
      const values = cols.map(c => serialize(clean[c], table, c));
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const res = await q.query(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        values
      );
      return normalizeRow(res.rows[0] || null);
    }

    function buildWhere(table, where) {
      assertWhere(table, where);
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
      const res = await q.query(sql, params);
      return res.rows.map(normalizeRow);
    }

    async function findOne(table, where) {
      const { clause, params } = buildWhere(table, where);
      const res = await q.query(`SELECT * FROM ${table}${clause} LIMIT 1`, params);
      return normalizeRow(res.rows[0] || null);
    }

    async function update(table, where, changes) {
      const clean = sanitize(table, changes);
      const keys = Object.keys(clean);
      const whereKeys = Object.keys(where || {});
      const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      const whereClause = whereKeys.map((k, i) => `${k} = $${keys.length + i + 1}`).join(' AND ');
      const params = [...keys.map(k => serialize(clean[k], table, k)), ...whereKeys.map(k => serialize(where[k], table, k))];
      const res = await q.query(
        `UPDATE ${table} SET ${setClause} WHERE ${whereClause} RETURNING *`,
        params
      );
      return normalizeRow(res.rows[0] || null);
    }

    async function count(table, where) {
      const { clause, params } = buildWhere(table, where);
      const res = await q.query(`SELECT COUNT(*)::int AS count FROM ${table}${clause}`, params);
      return res.rows[0].count;
    }

    async function del(table, where) {
      const { clause, params } = buildWhere(table, where);
      const res = await q.query(`DELETE FROM ${table}${clause}`, params);
      return res.rowCount;
    }

    return { insert, find, findOne, update, count, delete: del };
  }

  const ops = buildOps(pool);
  const { insert, find, findOne, update, count, delete: del } = ops;

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

  // Runs fn(tx) in ONE database transaction. tx has the same insert/find/
  // findOne/update/count/delete surface (and the same deals lifecycle guard)
  // bound to a single client; any throw rolls every statement back.
  async function withTransaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = guardDeals({ kind: 'pg', ...buildOps(client) });
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_rollbackErr) { /* connection already gone */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // Cross-process mutex (session-level PostgreSQL advisory lock) on a dedicated
  // connection. Tries for up to timeoutMs; returns { acquired:false } if another
  // session holds it, so the caller can leave its work recoverable. The lock is
  // released in finally; if the explicit unlock fails the connection is destroyed
  // so the server drops the session lock anyway.
  async function withAdvisoryLock(name, fn, opts = {}) {
    const timeoutMs = opts.timeoutMs === undefined ? 5000 : opts.timeoutMs;
    const client = await pool.connect();
    let locked = false;
    let destroy = false;
    try {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const r = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS got', [String(name)]);
        if (r.rows[0].got) { locked = true; break; }
        if (Date.now() >= deadline) return { acquired: false };
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return { acquired: true, value: await fn() };
    } catch (err) {
      destroy = true; // unknown connection state: never return a possibly-locked session to the pool
      throw err;
    } finally {
      if (locked && !destroy) {
        try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [String(name)]); } catch (_e) { destroy = true; }
      }
      client.release(destroy ? true : undefined);
    }
  }

  return guardDeals({ kind: 'pg', insert, find, findOne, update, count, delete: del, transaction, withTransaction, withAdvisoryLock });
}

const MEMORY_LOCKS = new Set();

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
    assertWhere(table, where);
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
    assertWhere(table, where);
    const row = tables[table].find(r => matches(r, where || {}));
    return row ? { ...row } : null;
  }

  function update(table, where, changes) {
    assertWhere(table, where);
    const clean = sanitize(table, changes);
    const row = tables[table].find(r => matches(r, where || {}));
    if (!row) return null;
    Object.assign(row, clean);
    if (hasTimestamps(table)) row.updated_at = now();
    return { ...row };
  }

  function count(table, where) {
    assertWhere(table, where);
    return tables[table].filter(r => matches(r, where || {})).length;
  }

  function del(table, where) {
    assertWhere(table, where);
    const before = tables[table].length;
    tables[table] = tables[table].filter(r => !matches(r, where || {}));
    return before - tables[table].length;
  }

  async function transaction(fn) {
    return fn(null);
  }

  // Same contract as the pg adapter: all-or-nothing. Snapshot and restore, with
  // transactions serialized so one rollback cannot clobber another's writes.
  let txChain = Promise.resolve();
  function withTransaction(fn) {
    const run = async () => {
      const snapshot = {};
      for (const t of Object.keys(tables)) snapshot[t] = tables[t].map(r => ({ ...r }));
      const seqBefore = seq;
      try {
        return await fn(guarded);
      } catch (err) {
        for (const t of Object.keys(snapshot)) tables[t] = snapshot[t];
        seq = seqBefore;
        throw err;
      }
    };
    const result = txChain.then(run, run);
    txChain = result.catch(() => {});
    return result;
  }

  // In-process mutex with the same contract as the pg advisory lock.
  async function withAdvisoryLock(name, fn, opts = {}) {
    const timeoutMs = opts.timeoutMs === undefined ? 5000 : opts.timeoutMs;
    const deadline = Date.now() + timeoutMs;
    while (MEMORY_LOCKS.has(name)) {
      if (Date.now() >= deadline) return { acquired: false };
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    MEMORY_LOCKS.add(name);
    try {
      return { acquired: true, value: await fn() };
    } finally {
      MEMORY_LOCKS.delete(name);
    }
  }

  const guarded = guardDeals({ kind: 'memory', insert, find, findOne, update, count, delete: del, transaction, withTransaction, withAdvisoryLock });
  return guarded;
}

module.exports = { createPgAdapter, createMemoryAdapter, registerPool, closeAllPools };
