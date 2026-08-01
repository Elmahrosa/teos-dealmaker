const state = new Map();

function begin(userId, payload) {
  state.set(userId, { payload: payload || {} });
}

function pending(userId) {
  return state.has(userId);
}

function payload(userId) {
  const s = state.get(userId);
  return s ? s.payload : null;
}

function clear(userId) {
  state.delete(userId);
}

module.exports = { begin, pending, payload, clear };
