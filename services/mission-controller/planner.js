const workforce = require('../workforce');
const { validateMission, normalizeMission } = require('./schema');

function planMission(input) {
  const source = typeof input === 'string' ? { goal: input } : (input || {});
  if (typeof source.goal !== 'string' || !source.goal.trim()) {
    return { valid: false, errors: ['goal is required to plan a mission'], mission: null, intent: null };
  }
  const planned = workforce.planner.planGoal(source.goal, {
    intent: source.intent,
    quality: source.quality
  });
  const mission = normalizeMission({
    title: source.title || String(source.goal).slice(0, 120),
    goal: source.goal,
    intent: planned.intent,
    priority: source.priority || 'normal',
    budgetCents: source.budgetCents || null,
    steps: planned.steps
  });
  const check = validateMission(mission);
  if (!check.valid) {
    return { valid: false, errors: check.errors, mission: null, intent: planned.intent };
  }
  return { valid: true, errors: [], mission, intent: planned.intent };
}

function withSteps(input) {
  const source = input || {};
  if (!Array.isArray(source.steps) || source.steps.length === 0) {
    return { valid: false, errors: ['steps must be a non-empty array'], mission: null, intent: null };
  }
  const mission = normalizeMission({
    title: source.title || 'Custom mission',
    goal: source.goal || '',
    intent: source.intent || 'general',
    priority: source.priority || 'normal',
    budgetCents: source.budgetCents || null,
    steps: source.steps
  });
  const check = validateMission(mission);
  if (!check.valid) {
    return { valid: false, errors: check.errors, mission: null, intent: mission.intent };
  }
  return { valid: true, errors: [], mission, intent: mission.intent };
}

function intentOf(goal) {
  return workforce.planner.intentOf(goal);
}

module.exports = { planMission, withSteps, intentOf };
