const workforce = require('../workforce');
const { planMission, withSteps } = require('./planner');
const state = require('./state');

function planFor(input) {
  if (typeof input === 'string' || (input && typeof input.goal === 'string' && input.goal.trim())) {
    return planMission(input);
  }
  return withSteps(input);
}

function delegateTo(adapter, workspaceId, mission) {
  const opts = {
    title: mission.title,
    priority: mission.priority,
    budgetCents: mission.budgetCents
  };
  if (mission.intent) opts.intent = mission.intent;
  if (mission.steps && mission.steps.length) opts.steps = mission.steps;
  if (mission.steps && mission.steps.length) {
    return workforce.runtime.runPlan(adapter, workspaceId, opts);
  }
  return workforce.runtime.runGoal(adapter, workspaceId, mission.goal, opts);
}

async function launch(adapter, workspaceId, input) {
  const planned = planFor(input);
  if (!planned.valid) {
    throw new Error(`Mission rejected: ${planned.errors.join('; ')}`);
  }
  const mission = planned.mission;
  const record = state.begin(`pre-${Date.now()}`, { status: 'planned', mission });
  state.transition(record.planId, 'running');

  let result;
  try {
    result = await delegateTo(adapter, workspaceId, mission);
  } catch (err) {
    state.transition(record.planId, 'failed', { error: err.message });
    throw err;
  }
  state.transition(record.planId, result.status, { planId: result.plan.id });
  return result;
}

async function list(adapter, workspaceId) {
  return workforce.runtime.listMissions(adapter, workspaceId);
}

async function status(adapter, workspaceId, planId) {
  const missions = await workforce.runtime.listMissions(adapter, workspaceId);
  return missions.find(m => m.id === planId) || null;
}

async function pause(adapter, workspaceId, planId) {
  return workforce.runtime.pause(adapter, workspaceId, planId);
}

async function resume(adapter, workspaceId, planId) {
  return workforce.runtime.resume(adapter, workspaceId, planId);
}

async function approveAndResume(adapter, workspaceId, requestId, userId) {
  return workforce.runtime.approveAndResume(adapter, workspaceId, requestId, userId);
}

async function executeCapability(adapter, workspaceId, stepOrTool, payload) {
  if (stepOrTool && typeof stepOrTool === 'object' && !Array.isArray(stepOrTool)) {
    if (typeof stepOrTool.tool !== 'string' || !stepOrTool.tool.trim()) {
      return { used: false, reason: 'no_tool_declared', step: stepOrTool.step_key || null };
    }
    return workforce.executeCapability(adapter, workspaceId, stepOrTool.tool, stepOrTool.toolInput || {});
  }
  return workforce.executeCapability(adapter, workspaceId, stepOrTool, payload);
}

module.exports = { launch, list, status, pause, resume, approveAndResume, executeCapability };
