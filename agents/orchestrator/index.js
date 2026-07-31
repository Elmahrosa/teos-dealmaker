const { processResponse } = require('../qualification');
const { runSalesCycle } = require('../sales');
const { draftResponse } = require('../sales/drafter');
const { reviewDraft } = require('../gatekeeper');
const { route } = require('../router');
const audit = require('../../utils/auditLogger');

function runOrchestrator(response) {
  console.log(`[Orchestrator] Processing response from ${response.from}`);

  const qualification = processResponse(response);
  audit.writeEntry('ORCHESTRATOR_QUALIFY', response.from, 'success', qualification);

  const { classification, routing } = qualification;
  let outcome;

  if (routing.action === 'escalate') {
    console.log(`[Orchestrator] Escalating to Sales: ${routing.reason}`);
    const salesResult = runSalesCycle(response.body || response.text || '');
    outcome = { stage: 'sales', result: salesResult };
    audit.writeEntry('ORCHESTRATOR_ROUTE', response.from, 'SALES', {
      reason: routing.reason,
      objection_type: salesResult.objection_type,
      suggested_action: salesResult.suggested_action,
      response_id: classification.response_id
    });
  } else if (routing.action === 'follow_up') {
    console.log(`[Orchestrator] Scheduling follow-up: ${routing.reason}`);
    outcome = { stage: 'follow_up', result: routing };
    audit.writeEntry('ORCHESTRATOR_ROUTE', response.from, 'FOLLOW_UP', {
      reason: routing.reason,
      target_agent: routing.target_agent,
      response_id: classification.response_id
    });
  } else {
    console.log(`[Orchestrator] Archiving: ${routing.reason}`);
    outcome = { stage: 'archive', result: routing };
    audit.writeEntry('ORCHESTRATOR_ROUTE', response.from, 'ARCHIVE', {
      reason: routing.reason,
      response_id: classification.response_id
    });
  }

  audit.writeEntry('ORCHESTRATOR_RUN', response.from, 'success', {
    response_id: classification.response_id,
    sentiment: classification.sentiment,
    fit: classification.fit.label,
    stage: outcome.stage
  });

  return { classification, routing, outcome };
}

function runSalesFlow(prompt, userId) {
  console.log(`[Orchestrator] Sales request from ${userId}: "${(prompt || '').slice(0, 50)}..."`);

  const draft = draftResponse(prompt, userId);
  console.log(`[Orchestrator] Sales drafted (${draft.objectionType}): ${draft.draft.slice(0, 60)}...`);

  const review = reviewDraft(draft.draft, 'sales-draft');
  console.log(`[Orchestrator] Gatekeeper decision: ${review.decision}`);

  let routed = null;

  if (review.decision === 'APPROVE') {
    const message = { id: 'sales_' + Date.now(), body: review.draft };
    routed = route(message, 'customer');
    audit.writeEntry('ORCHESTRATOR_REQUEST_COMPLETED', String(userId || 'unknown'), 'success', {
      specialist: 'SALES',
      status: 'success',
      objection_type: draft.objectionType,
      decision: review.decision
    });
  } else {
    audit.writeEntry('ORCHESTRATOR_REQUEST_COMPLETED', String(userId || 'unknown'), 'blocked', {
      specialist: 'SALES',
      status: 'blocked',
      reasons: review.reasons
    });
  }

  return { draft, review, routed, status: review.decision === 'APPROVE' ? 'success' : 'blocked' };
}

module.exports = { runOrchestrator, runSalesFlow };
