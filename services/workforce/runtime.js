const { forWorkspace } = require('../../db/repos');
const planner = require('./planner');
const scheduler = require('./scheduler');
const executor = require('./executor');
const approvals = require('./approvals');
const telemetry = require('./telemetry');
const { emit, EVENT_NAMES } = require('./events');

function buildBriefing(plan, steps) {
  const lines = [`Executive briefing — ${plan.title}`, ''];
  const completed = steps.filter(s => s.status === 'completed');
  for (const s of completed) {
    const out = String(s.output || '').split('\n')[0];
    lines.push(`• ${s.agent_type} (${s.step_key}): ${out}`);
  }
  lines.push('', `Plan status: ${plan.status}. ${completed.length}/${steps.length} steps completed.`);
  return lines.join('\n');
}

async function runPlan(adapter, workspaceId, opts) {
  const o = opts || {};
  const repos = forWorkspace(adapter, workspaceId);

  let plan;
  if (o.planId) {
    plan = await repos.plans.get(o.planId);
    if (!plan) throw new Error(`Plan ${o.planId} not found in workspace`);
    plan = { ...plan, metrics: plan.metrics || {} };
  } else {
    const steps = o.steps && o.steps.length ? o.steps : planner.planGoal(o.goal || 'General goal', o).steps;
    plan = await repos.plans.create({
      title: o.title || String(o.goal || 'Autonomous workflow').slice(0, 200),
      goal: o.goal || o.title || '',
      status: 'planned',
      priority: o.priority || 'normal',
      metrics: { total_steps: steps.length, completed_steps: 0, total_cost_cents: 0, budget_cents: o.budgetCents || null },
      version: 'v0.8.0'
    });
    for (const s of steps) {
      await repos.planSteps.create({
        plan_id: plan.id,
        step_key: s.step_key,
        agent_type: s.agent_type,
        step_group: s.step_group || null,
        depends_on: s.depends_on || null,
        task: s.task,
        priority: s.priority || 3,
        provider: s.provider || null,
        model: s.model || null
      });
    }
    emit(EVENT_NAMES.PLAN_CREATED, { planId: plan.id, title: plan.title, steps: steps.length });
  }

  await repos.plans.update(plan.id, { status: 'running' });
  emit(EVENT_NAMES.PLAN_STARTED, { planId: plan.id, title: plan.title });

  const allApprovals = await repos.approvals.list();
  const initialSteps = await repos.planSteps.list(plan.id);
  for (const step of initialSteps.filter(s => s.status === 'awaiting_approval')) {
    const decided = allApprovals.find(a => a.step_id === step.id && a.status !== 'pending');
    if (decided) {
      await repos.planSteps.update(step.id, {
        status: decided.status === 'approved' ? 'completed' : 'skipped',
        completed_at: new Date().toISOString()
      });
    }
  }

  const startedAt = Date.now();
  let failed = false;
  let halted = false;
  let failReason = null;

  for (let round = 0; round < 200; round++) {
    const steps = await repos.planSteps.list(plan.id);
    const done = steps.filter(s => s.status === 'completed').map(s => s.step_key);
    const failedStep = steps.find(s => s.status === 'failed');
    if (failedStep) {
      failed = true;
      failReason = failedStep.error || 'Step failed';
      break;
    }
    const awaiting = steps.find(s => s.status === 'awaiting_approval');
    if (awaiting) {
      halted = true;
      break;
    }
    const ready = scheduler.readySteps(steps, done);
    if (!ready.length) break;
    const outcomes = await Promise.all(ready.map(s => executor.executeStep(adapter, workspaceId, s, {})));
    const failedOutcome = outcomes.find(out => out.status === 'failed');
    if (failedOutcome) {
      failed = true;
      failReason = failedOutcome.error || 'Step failed';
      break;
    }
    if (outcomes.some(out => out.status === 'awaiting_approval')) {
      halted = true;
      break;
    }
  }

  const finalSteps = await repos.planSteps.list(plan.id);
  const completedCount = finalSteps.filter(s => s.status === 'completed').length;
  const planRuns = (await repos.agentRuns.list()).filter(r => r.plan_id === plan.id);
  const totalCostCents = planRuns.reduce((acc, r) => acc + (r.cost_cents || 0), 0);
  const confidenceValues = finalSteps.filter(s => typeof s.confidence === 'number').map(s => s.confidence);
  const avgConfidence = confidenceValues.length
    ? Math.round(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length * 100) / 100
    : null;

  const pendingApprovals = [];
  if (halted) {
    const awaitingStep = finalSteps.find(s => s.status === 'awaiting_approval');
    if (awaitingStep) {
      const pending = await approvals.pendingForStep(adapter, workspaceId, awaitingStep.id);
      if (pending) pendingApprovals.push({ requestId: pending.id, stepId: awaitingStep.id, agentType: awaitingStep.agent_type, reason: pending.reason });
    }
  }

  const status = failed ? 'failed' : halted ? 'waiting_approval' : 'completed';
  const budget = (plan.metrics && plan.metrics.budget_cents) || null;
  const budgetExceeded = budget !== null && totalCostCents > budget;
  const finalStatus = budgetExceeded ? 'budget_exceeded' : status;
  await repos.plans.update(plan.id, {
    status: finalStatus,
    metrics: {
      total_steps: finalSteps.length,
      completed_steps: completedCount,
      awaiting_approval: halted ? 1 : 0,
      duration_ms: Date.now() - startedAt,
      avg_confidence: avgConfidence,
      total_cost_cents: totalCostCents,
      budget_cents: budget,
      budget_exceeded: budgetExceeded ? true : null
    }
  });

  const finalPlan = await repos.plans.get(plan.id);
  const briefing = buildBriefing({ ...finalPlan, title: finalPlan.title }, finalSteps);

  if (!failed && !halted && !budgetExceeded) {
    const memoryValue = `Plan "${finalPlan.title}" completed: ${completedCount} steps. ${briefing.split('\n').slice(2, -1).join(' ')}`;
    await repos.memory.set(`plan_${plan.id}`, memoryValue, 'workflow');
    emit(EVENT_NAMES.MEMORY_UPDATED, { planId: plan.id });
    await repos.intelligence.add({
      title: `Plan: ${finalPlan.title}`,
      source_type: 'plan',
      content: briefing,
      metadata: { plan_id: plan.id, status: finalPlan.status }
    });
  }
  emit(failed ? EVENT_NAMES.PLAN_FAILED : halted ? EVENT_NAMES.PLAN_STARTED : EVENT_NAMES.PLAN_COMPLETED, {
    planId: plan.id,
    status,
    failReason
  });
  emit(EVENT_NAMES.BRIEFING_READY, { planId: plan.id, briefing });

  const snapshot = await telemetry.snapshot(adapter, workspaceId);
  return { plan: finalPlan, steps: finalSteps, briefing, pendingApprovals, status: finalStatus, telemetry: snapshot };
}

async function runGoal(adapter, workspaceId, goal, opts) {
  const o = opts || {};
  const planned = planner.planGoal(goal, o);
  return runPlan(adapter, workspaceId, {
    title: o.title || goal.slice(0, 120),
    goal,
    priority: o.priority || 'normal',
    steps: planned.steps,
    quality: o.quality,
    budgetCents: o.budgetCents
  });
}

async function runSalesStrategy(adapter, workspaceId, opts) {
  const o = opts || {};
  const learning = require('../learning');
  const revenueStrategist = require('../../agents/revenueStrategist');
  const knowledge = await learning.getKnowledge(adapter, workspaceId);
  const strategy = revenueStrategist.buildSalesStrategy(knowledge);
  const company = knowledge.company.company_name || 'your company';
  const products = strategy.pricing.length ? strategy.pricing.map(p => p.name).join(', ') : 'your products';
  const competitors = Array.isArray(knowledge.company.competitors) ? knowledge.company.competitors.join(', ') : 'your market';

  const steps = [
    { step_key: 'assess', agent_type: 'revenue_strategist', task: `Act as Revenue Strategist. Decide whether a sales strategy mission for ${company} makes sense, set success criteria and a budget, and decide when to ask for human approval.` },
    { step_key: 'competitors', agent_type: 'intelligence', task: `Research competitors: ${competitors}. Explain why customers should choose ${company} instead, grounded in company knowledge.`, group: 'parallel' },
    { step_key: 'targets', agent_type: 'market_intelligence', task: `Identify target industries and build the ideal customer profile for ${company} using the known ICP and personas.`, group: 'parallel' },
    { step_key: 'positioning', agent_type: 'strategist', task: `Recommend positioning and a pricing strategy for these products: ${products}. Anchor prices and define the value message.`, depends_on: ['competitors'] },
    { step_key: 'accounts', agent_type: 'revenue_strategist', task: `Produce a prioritized target account list and estimate pipeline potential for ${company}.`, depends_on: ['targets', 'positioning'] },
    { step_key: 'present', agent_type: 'gatekeeper', task: 'Present the final sales strategy, prioritized target account list and pipeline estimate to the founder. Requires founder approval before presenting.', depends_on: ['accounts'] }
  ];

  const plan = await runPlan(adapter, workspaceId, {
    title: o.title || 'Sell TEOS Dealmaker',
    goal: o.goal || 'Create a sales strategy to sell TEOS Dealmaker: ideal customer profile, positioning, pricing, target accounts and pipeline estimate.',
    priority: o.priority || 'high',
    steps,
    budgetCents: o.budgetCents || strategy.pipelineEstimate.acv ? (o.budgetCents || 800) : 800
  });
  return { ...plan, strategy };
}

async function resume(adapter, workspaceId, planId) {
  return runPlan(adapter, workspaceId, { planId });
}

async function pause(adapter, workspaceId, planId) {
  const repos = forWorkspace(adapter, workspaceId);
  const plan = await repos.plans.get(planId);
  if (!plan) throw new Error(`Plan ${planId} not found in workspace`);
  if (plan.status === 'completed' || plan.status === 'failed') {
    return { plan, paused: false, reason: `${plan.status}` };
  }
  await repos.plans.update(planId, { status: 'paused' });
  const updated = await repos.plans.get(planId);
  return { plan: updated, paused: true };
}

async function listMissions(adapter, workspaceId) {
  const repos = forWorkspace(adapter, workspaceId);
  const plans = await repos.plans.list();
  const stepsByPlan = {};
  for (const plan of plans) {
    stepsByPlan[plan.id] = await repos.planSteps.list(plan.id);
  }
  return plans.map(plan => {
    const steps = stepsByPlan[plan.id] || [];
    const completed = steps.filter(s => s.status === 'completed').length;
    const awaiting = steps.filter(s => s.status === 'awaiting_approval').length;
    const failed = steps.find(s => s.status === 'failed');
    const confidenceValues = steps.filter(s => typeof s.confidence === 'number').map(s => s.confidence);
    const avgConfidence = confidenceValues.length ? Math.round(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length * 100) / 100 : null;
    const pendingStep = steps.find(s => s.status === 'pending');
    return {
      id: plan.id,
      title: plan.title,
      goal: plan.goal,
      status: plan.status,
      priority: plan.priority,
      total_steps: steps.length,
      completed_steps: completed,
      awaiting_approval: awaiting,
      progress: steps.length ? Math.round((completed / steps.length) * 100) : 0,
      avg_confidence: avgConfidence,
      next_action: pendingStep ? pendingStep.task : null,
      next_agent: pendingStep ? pendingStep.agent_type : null,
      error: failed ? failed.error : null,
      created_at: plan.created_at,
      metrics: plan.metrics || {}
    };
  });
}

async function approveAndResume(adapter, workspaceId, requestId, userId) {
  const decision = await approvals.decide(adapter, workspaceId, requestId, 'approve', userId);
  if (decision.status !== 'approved') return { decision, resumed: false };
  const step = decision.step_id ? await forWorkspace(adapter, workspaceId).planSteps.get(decision.step_id) : null;
  const planId = decision.plan_id || (step && step.plan_id);
  if (!planId) return { decision, resumed: false };
  const outcome = await runPlan(adapter, workspaceId, { planId });
  return { decision, resumed: true, ...outcome };
}

module.exports = { runPlan, runGoal, runSalesStrategy, resume, pause, listMissions, approveAndResume, buildBriefing };
