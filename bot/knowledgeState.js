const state = new Map();

function begin(userId, flow, payload) {
  state.set(userId, { flow, payload });
}

function pending(userId) {
  const s = state.get(userId);
  return s ? s.flow : null;
}

function payload(userId) {
  const s = state.get(userId);
  return s ? s.payload : null;
}

function clear(userId) {
  state.delete(userId);
}

module.exports = { begin, pending, payload, clear };
