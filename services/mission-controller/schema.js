const workforce = require('../workforce');

const MISSION_VERSION = 'v0.9.0';

const INTENTS = ['deal', 'proposal', 'outreach', 'research', 'qualification', 'general'];

const STEP_GROUPS = ['sequential', 'parallel'];

const MISSION_LIFECYCLE = [
  'proposed',
  'planned',
  'running',
  'waiting_approval',
  'paused',
  'completed',
  'failed',
  'budget_exceeded',
  'cancelled'
];

const STEP_STATUS = ['pending', 'running', 'completed', 'failed', 'awaiting_approval', 'skipped'];

function knownAgentTypes() {
  const types = new Set(Object.keys(workforce.REGISTRY));
  for (const key of Object.keys(workforce.planner.PRIORITY_BY_AGENT)) types.add(key);
  return types;
}

function validateStep(step, index, errors) {
  if (!step || typeof step !== 'object') {
    errors.push(`steps[${index}] must be an object`);
    return;
  }
  if (typeof step.step_key !== 'string' || !step.step_key.trim()) {
    errors.push(`steps[${index}]: step_key is required`);
  }
  if (typeof step.agent_type !== 'string' || !step.agent_type.trim()) {
    errors.push(`steps[${index}]: agent_type is required`);
  } else if (!knownAgentTypes().has(step.agent_type)) {
    errors.push(`steps[${index}]: unknown agent_type "${step.agent_type}"`);
  }
  if (typeof step.task !== 'string' || !step.task.trim()) {
    errors.push(`steps[${index}]: task is required`);
  }
  if (step.step_group !== undefined && step.step_group !== null && !STEP_GROUPS.includes(step.step_group)) {
    errors.push(`steps[${index}]: invalid step_group "${step.step_group}" (expected ${STEP_GROUPS.join(' or ')})`);
  }
  if (step.priority !== undefined && step.priority !== null &&
      (typeof step.priority !== 'number' || step.priority < 1 || step.priority > 6)) {
    errors.push(`steps[${index}]: priority must be a number 1-6`);
  }
  if (step.depends_on !== undefined && step.depends_on !== null && !Array.isArray(step.depends_on)) {
    errors.push(`steps[${index}]: depends_on must be an array of step_keys`);
  }
}

function validateMission(mission) {
  const errors = [];
  if (!mission || typeof mission !== 'object') {
    return { valid: false, errors: ['mission must be an object'] };
  }
  if (typeof mission.title !== 'string' || !mission.title.trim()) errors.push('title is required');
  if (typeof mission.goal !== 'string' || !mission.goal.trim()) errors.push('goal is required');
  if (mission.intent !== undefined && mission.intent !== null && !INTENTS.includes(mission.intent)) {
    errors.push(`intent must be one of: ${INTENTS.join(', ')}`);
  }
  if (mission.budgetCents !== undefined && mission.budgetCents !== null &&
      (typeof mission.budgetCents !== 'number' || mission.budgetCents <= 0)) {
    errors.push('budgetCents must be a positive number');
  }
  if (!Array.isArray(mission.steps) || mission.steps.length === 0) {
    errors.push('steps must be a non-empty array');
  } else {
    const keys = new Set();
    mission.steps.forEach((step, i) => {
      validateStep(step, i, errors);
      if (step && typeof step.step_key === 'string' && step.step_key.trim()) {
        if (keys.has(step.step_key)) errors.push(`duplicate step_key "${step.step_key}"`);
        keys.add(step.step_key);
      }
    });
    mission.steps.forEach((step, i) => {
      if (step && Array.isArray(step.depends_on)) {
        for (const dep of step.depends_on) {
          if (!keys.has(dep)) errors.push(`steps[${i}]: depends_on references unknown step_key "${dep}"`);
        }
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

function normalizeMission(mission) {
  return {
    version: MISSION_VERSION,
    status: 'proposed',
    priority: mission.priority || 'normal',
    budgetCents: mission.budgetCents || null,
    metrics: {
      total_steps: mission.steps ? mission.steps.length : 0,
      completed_steps: 0,
      total_cost_cents: 0
    },
    ...mission
  };
}

module.exports = {
  MISSION_VERSION,
  INTENTS,
  STEP_GROUPS,
  MISSION_LIFECYCLE,
  STEP_STATUS,
  knownAgentTypes,
  validateStep,
  validateMission,
  normalizeMission
};
