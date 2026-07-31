let adapter = null;

function getStoreAdapter() {
  if (!adapter) {
    if (process.env.DATABASE_URL) {
      adapter = require('../db').getAdapter();
    } else {
      adapter = require('../db').createMemoryAdapter();
    }
  }
  return adapter;
}

function isPersistent() {
  return Boolean(process.env.DATABASE_URL);
}

module.exports = { getStoreAdapter, isPersistent };
