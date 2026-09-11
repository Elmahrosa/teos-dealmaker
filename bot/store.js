let adapter = null;

function getStoreAdapter() {
  if (!adapter) {
    // Hard guard: unit / DRY tests must never touch the live Postgres / Supabase
    // instance, even if a parent process leaked DATABASE_URL.
    if (process.env.NODE_ENV === 'test') {
      adapter = require('../db').createMemoryAdapter();
    } else {
      // resolveAdapter centralizes the fallback policy: pg when DATABASE_URL is
      // set, memory (with a loud log) only in development, throw in production.
      adapter = require('../db').resolveAdapter();
    }
  }
  return adapter;
}

function isPersistent() {
  return Boolean(process.env.DATABASE_URL) && process.env.NODE_ENV !== 'test';
}

module.exports = { getStoreAdapter, isPersistent };
