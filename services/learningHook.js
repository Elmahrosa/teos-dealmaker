'use strict';

const { createRepos } = require('../db/repos');
const { on, EVENT_NAMES } = require('./workforce/events');

let installed = false;

async function writeLessons(adapter, evt, outcome) {
  const { workspaceId, planId } = evt;
  if (!workspaceId || !planId) return null;

  const repos = createRepos(adapter);
  const plan = await repos.plans.get(workspaceId, planId);
  if (!plan) return null;

  const steps = (await repos.planSteps.list(workspaceId, planId)) || [];
  const completed = steps.filter(s => s.status === 'completed');
  const failed = steps.filter(s => s.status === 'failed');

  const content = [
    `Plan: ${plan.title || plan.objective || `#${planId}`}`,
    `Outcome: ${outcome}`,
    `Completed steps: ${completed.length}/${steps.length}`,
    `Failed steps: ${failed.length}`,
    completed.length ? `Completed: ${completed.map(s => `- ${s.action}`).join('; ')}` : null,
    failed.length ? `Failures: ${failed.map(s => `${s.action}: ${s.reason || 'unknown'}`).join('; ')}` : null,
    plan.metrics ? `Metrics: ${JSON.stringify(plan.metrics)}` : null,
    `Recorded ${new Date().toISOString()}`
  ].filter(Boolean);

  return repos.intelligence.add({
    workspace_id: workspaceId,
    title: `Lesson: ${plan.title || `plan ${planId}`} (${outcome})`,
    source_type: 'lessons',
    content: content.join('\n'),
    metadata: { kind: 'lesson', plan_id: planId, outcome, workspace_id: workspaceId }
  });
}

function install(adapterProvider) {
  if (installed) return { installed: false, reason: 'already installed' };
  installed = true;

  on(EVENT_NAMES.PLAN_COMPLETED, async evt => {
    try {
      const adapter = typeof adapterProvider === 'function' ? adapterProvider() : adapterProvider;
      if (!adapter) return;
      await writeLessons(adapter, evt, 'completed');
    } catch (_err) {
      // learning must never crash the event bus
    }
  });

  on(EVENT_NAMES.PLAN_FAILED, async evt => {
    try {
      const adapter = typeof adapterProvider === 'function' ? adapterProvider() : adapterProvider;
      if (!adapter) return;
      await writeLessons(adapter, evt, 'failed');
    } catch (_err) {
      // learning must never crash the event bus
    }
  });

  return { installed: true };
}

module.exports = { install, writeLessons };
