let adapter = null;

function getStoreAdapter() {
  if (!adapter) {
    // Hard guard: unit / DRY tests must never touch the live Postgres / Supabase
    // instance, even if a parent process leaked DATABASE_URL.
    if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) {
      adapter = require('../db').createMemoryAdapter();
    } else {
      adapter = require('../db').getAdapter();
    }
  }
  return adapter;
}

function isPersistent() {
  return Boolean(process.env.DATABASE_URL) && process.env.NODE_ENV !== 'test';
}

module.exports = { getStoreAdapter, isPersistent };
