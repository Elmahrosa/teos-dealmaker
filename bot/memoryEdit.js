const state = new Map();

function begin(userId, key) {
  state.set(userId, key);
}

function pending(userId) {
  return state.get(userId) || null;
}

function clear(userId) {
  state.delete(userId);
}

module.exports = { begin, pending, clear };
