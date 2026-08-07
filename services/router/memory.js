// services/router/memory.js
// v1.1 conversation memory. Holds the active state of a conversation per user
// and never resets mid-conversation: currentIntent / currentAgent / workspace /
// language / approvalState / lastMission / missingInformation /
// recentConversation / founderMode. In-memory per process; persisted
// conversation memory (db table) is layered on top in a later phase.
'use strict';

const MAX_HISTORY = 16;

const sessions = new Map();

function defaultSession() {
  return {
    currentIntent: null,
    currentAgent: null,
    lastAgent: null,
    workspace: null,
    language: null,
    approvalState: null,
    lastMission: null,
    currentMission: null,
    customer: null,
    lastQuestion: null,
    missingInformation: [],
    recentConversation: [],
    founderMode: false
  };
}

function get(userId) {
  const key = String(userId);
  if (!sessions.has(key)) sessions.set(key, defaultSession());
  return sessions.get(key);
}

function set(userId, patch) {
  const s = get(userId);
  Object.assign(s, patch);
  return s;
}

function update(userId, patch) {
  return set(userId, patch);
}

function pushMessage(userId, role, text) {
  const s = get(userId);
  s.recentConversation.push({ role, text, at: new Date().toISOString() });
  if (s.recentConversation.length > MAX_HISTORY) {
    s.recentConversation = s.recentConversation.slice(-MAX_HISTORY);
  }
  return s;
}

function rememberMissing(userId, key) {
  const s = get(userId);
  if (!s.missingInformation.includes(key)) s.missingInformation.push(key);
  return s;
}

function clearMissing(userId, key) {
  const s = get(userId);
  s.missingInformation = s.missingInformation.filter((k) => k !== key);
  return s;
}

function clear(userId) {
  sessions.delete(String(userId));
}

function all() {
  return [...sessions.entries()];
}

function reset() {
  sessions.clear();
}

module.exports = { get, set, update, pushMessage, rememberMissing, clearMissing, clear, all, reset };
