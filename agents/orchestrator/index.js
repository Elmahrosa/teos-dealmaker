const { processResponse } = require('../qualification');
const { runSalesCycle } = require('../sales');
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

module.exports = { runOrchestrator };
