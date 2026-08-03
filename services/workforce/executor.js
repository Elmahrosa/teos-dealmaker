const { forWorkspace } = require('../../db/repos');
const { runAgent } = require('./runner');
const dispatcher = require('./dispatcher');
const reviewer = require('./reviewer');
const confidence = require('./confidence');
const approvals = require('./approvals');
const recovery = require('./recovery');
const telemetry = require('./telemetry');
const { emit, EVENT_NAMES } = require('./events');

async function executeStep(adapter, workspaceId, step, opts) {
  const o = opts || {};
  const repos = forWorkspace(adapter, workspaceId);
  const route = dispatcher.dispatch({ agentType: step.agent_type, priority: step.priority, opts: o });

  await repos.planSteps.update(step.id, {
    status: 'running',
    started_at: new Date().toISOString(),
    attempt: (step.attempt || 0) + 1
  });
  emit(EVENT_NAMES.TASK_STARTED, { stepId: step.id, planId: step.plan_id, agentType: step.agent_type, task: step.task });

  const startedAt = Date.now();
  let run = null;
  let attempts = 0;
  let lastError = null;

  const runOnce = async (taskPrompt) => {
    attempts += 1;
    return runAgent(adapter, workspaceId, step.agent_type, null, {
      prompt: taskPrompt,
      plan_id: step.plan_id,
      provider: route.provider,
      model: route.model,
      temperature: 0.4
    });
  };

  try {
    run = await recovery.withRetry(() => runOnce(step.task), {
      maxRetries: route.retryPolicy.maxRetries,
      backoffMs: route.retryPolicy.backoffMs,
      onProviderFailure: err => emit(EVENT_NAMES.PROVIDER_FAILED, { stepId: step.id, provider: route.provider, error: err.message })
    });
  } catch (err) {
    lastError = err;
    emit(EVENT_NAMES.TASK_FAILED, { stepId: step.id, planId: step.plan_id, agentType: step.agent_type, error: err.message });
    await repos.planSteps.update(step.id, { status: 'failed', error: err.message, completed_at: new Date().toISOString() });
    return { stepId: step.id, status: 'failed', error: err.message, attempts };
  }

  let output = run.result && run.result.output ? run.result.output : '';
  let review = await reviewer.reviewStep(adapter, workspaceId, step, output, {});

  let revisions = 0;
  while (review.decision !== 'approve' && revisions < 1 && !o.skipRevision) {
    revisions += 1;
    const feedbackPrompt = `${step.task}\n\nReviewer feedback: ${review.feedback} Rewrite the output addressing every point.`;
    try {
      const rerun = await recovery.withRetry(() => runOnce(feedbackPrompt), {
        maxRetries: route.retryPolicy.maxRetries,
        backoffMs: route.retryPolicy.backoffMs
      });
      output = rerun.result && rerun.result.output ? rerun.result.output : output;
      run = rerun;
    } catch (err) {
      lastError = err;
    }
    review = await reviewer.reviewStep(adapter, workspaceId, step, output, {});
  }

  const retries = Math.max(0, attempts - 1);
  const conf = confidence.evaluate({ review, simulated: !!(run && run.result && run.result.simulated), retries, attempts });

  const latencyMs = Date.now() - startedAt;
  const costCents = run && run.cost_cents ? run.cost_cents : 0;
  const tokens = run && run.result
    ? { input_tokens: run.result.input_tokens || 0, output_tokens: run.result.output_tokens || 0 }
    : { input_tokens: 0, output_tokens: 0 };

  if (run && run.result && run.result.provider) {
    await telemetry.record(adapter, workspaceId, {
      provider: run.result.provider,
      model: run.result.model || null,
      ...tokens,
      cost_cents: costCents,
      latency_ms: latencyMs,
      retries,
      failures: lastError ? 1 : 0,
      confidence: conf.confidence
    });
  }

  const gates = approvals.gatesFor(step);
  const lowConfidence = confidence.needsApproval(conf.confidence);
  const needsHuman = gates.length > 0 || lowConfidence;

  if (needsHuman) {
    const reason = gates.length
      ? `High-risk action requiring founder approval: ${gates.join(', ')}.`
      : `Confidence ${Math.round(conf.confidence * 100)}% (${conf.label}) is below the auto-approval threshold.`;
    const approvalRow = await approvals.request(adapter, workspaceId, {
      plan_id: step.plan_id,
      step_id: step.id,
      agent_type: step.agent_type,
      reason
    });
    const approvalData = { approvalId: approvalRow.id, gates, reason, lowConfidence };
    await repos.planSteps.update(step.id, {
      status: 'awaiting_approval',
      output,
      review: { ...review, revised: revisions },
      approval: approvalData,
      confidence: conf.confidence,
      retries,
      attempt: attempts,
      completed_at: new Date().toISOString()
    });
    emit(EVENT_NAMES.CONFIDENCE_LOW, { stepId: step.id, confidence: conf.confidence, label: conf.label, reason });
    return { stepId: step.id, status: 'awaiting_approval', output, review, confidence: conf, approvalId: approvalRow.id, gates };
  }

  await repos.planSteps.update(step.id, {
    status: 'completed',
    output,
    review: { ...review, revised: revisions },
    confidence: conf.confidence,
    retries,
    attempt: attempts,
    completed_at: new Date().toISOString()
  });
  emit(EVENT_NAMES.TASK_COMPLETED, { stepId: step.id, planId: step.plan_id, agentType: step.agent_type, status: 'completed' });
  return { stepId: step.id, status: 'completed', output, review, confidence: conf, attempts, retries };
}

module.exports = { executeStep };
