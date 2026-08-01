const { forWorkspace } = require('../../db/repos');
const { emit, EVENT_NAMES } = require('./events');

function heuristicScore(step, output) {
  const text = String(output || '');
  const words = text.split(/\s+/).filter(Boolean).length;
  const checks = [];

  const hallucination = /just kidding|i'm not sure|lorem ipsum|\[TODO\]|placeholder|made up/i;
  checks.push({ name: 'hallucination', pass: !hallucination.test(text), note: hallucination.test(text) ? 'contains hedging or placeholder language' : 'no hallucination markers' });

  checks.push({ name: 'data', pass: words >= 20 || (step.task && step.task.length > 60), note: `word count ${words}` });

  checks.push({ name: 'formatting', pass: /[\n:.•]/.test(text), note: /[\n:.•]/.test(text) ? 'structured output' : 'flat text, no structure' });

  const harsh = /\b(must buy|guaranteed|foolproof|always|never trust)\b/i;
  checks.push({ name: 'tone', pass: !harsh.test(text), note: harsh.test(text) ? 'aggressive or over-promising tone' : 'measured tone' });

  if (/pric|term|discount|rate|fee|invoice/i.test(step.task || '')) {
    checks.push({ name: 'pricing', pass: /\d/.test(text), note: /\d/.test(text) ? 'contains figures' : 'no figures for a pricing-sensitive task' });
  }

  const passed = checks.filter(c => c.pass).length;
  const base = checks.length ? (passed / checks.length) * 90 : 90;
  const bonus = words >= 60 ? 10 : words >= 30 ? 5 : 0;
  const score = Math.min(100, Math.round(base) + bonus);
  const failures = checks.filter(c => !c.pass).map(c => c.name);
  const decision = score >= 80 ? 'approve' : score >= 60 ? 'revise' : 'reject';
  return {
    score,
    checks,
    failures,
    decision,
    feedback: failures.length ? `Fix before proceeding: ${failures.join(', ')}.` : 'Output passes review checks.',
    wordCount: words
  };
}

async function reviewStep(adapter, workspaceId, step, output, opts) {
  const o = opts || {};
  const repos = forWorkspace(adapter, workspaceId);
  const review = o.override && typeof o.override.score === 'number'
    ? {
        score: o.override.score,
        decision: o.override.decision || (o.override.score >= 80 ? 'approve' : o.override.score >= 60 ? 'revise' : 'reject'),
        failures: o.override.failures || [],
        feedback: o.override.feedback || 'Manual review result.',
        checks: [],
        wordCount: String(output || '').split(/\s+/).filter(Boolean).length,
        simulated: true
      }
    : heuristicScore(step, output);

  await repos.planSteps.update(step.id, { review: { ...review, reviewedAt: new Date().toISOString() } });
  emit(EVENT_NAMES.REVIEW_COMPLETED, { stepId: step.id, agentType: step.agent_type, score: review.score, decision: review.decision });
  return review;
}

module.exports = { heuristicScore, reviewStep };
