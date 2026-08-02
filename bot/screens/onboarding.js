const botLearning = require('../learning');
const { learnScreen } = require('./lib');

function begin(userId) {
  botLearning.begin(userId);
}

function quit(userId) {
  botLearning.clear(userId);
}

async function prompt(userId, adapter, workspaceId) {
  return learnScreen(await botLearning.buildPrompt(userId, adapter, workspaceId));
}

async function skip(userId, adapter, workspaceId) {
  const res = await botLearning.handleSkip(userId, adapter, workspaceId);
  if (!res) return learnScreen(await botLearning.buildPrompt(userId, adapter, workspaceId));
  return learnScreen(res);
}

async function answer(userId, adapter, workspaceId) {
  return learnScreen(await botLearning.handleAnswer(userId, adapter, workspaceId, 'done'));
}

async function more(userId, adapter, workspaceId) {
  botLearning.another(userId);
  return learnScreen(await botLearning.buildPrompt(userId, adapter, workspaceId));
}

async function persona(userId, adapter, workspaceId, name) {
  return learnScreen(await botLearning.handleName(userId, adapter, workspaceId, name));
}

module.exports = { begin, quit, prompt, skip, answer, more, persona };
