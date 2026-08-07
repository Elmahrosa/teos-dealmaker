const design = require('../design');

const PIPELINE_STAGES = ['Strategist', 'Marketer', 'Negotiator', 'Treasurer', 'Closing'];

function buildPipeline() {
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Sales Pipeline')}`,
    design.it('Final deal flow — 5 stages'),
    design.divider(),
    design.progressBar(PIPELINE_STAGES, -1).join('\n'),
    design.divider(),
    design.it('Run the full pipeline to execute all five agents and record the result to the audit vault.')
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Run Pipeline', 'cc_pipeline_run')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function buildPipelineResult(userId, result) {
  const notes = (result.notes || []).map(n =>
    `${design.code(n.agent_name)} ${n.note}`
  );
  const lines = [
    `${design.EMOJI.ai} ${design.b('Pipeline Run')}`,
    design.it('Strategist → Marketer → Negotiator → Treasurer → Gatekeeper → Closing'),
    design.divider(),
    design.row('Strategy', result.strategy.style),
    design.row('Positioning', result.marketing.headline),
    design.row('Landing price', `$${result.negotiation.landingPrice}`),
    design.row('Terms', result.negotiation.suggestedTerms),
    design.row('Contract', `${result.treasurer.contract.company} · $${result.treasurer.contract.amount} ${result.treasurer.contract.currency} · ${result.treasurer.contract.termMonths}mo`),
    design.row('Checkout', result.treasurer.checkout ? result.treasurer.checkout.url : 'blocked'),
    design.row('Gatekeeper', design.badge(result.gatekeeper.decision === 'APPROVE' ? 'success' : 'warning')),
    design.row('Outcome', design.badge(result.closing.status === 'won' ? 'success' : 'critical')),
    design.row('Deal saved', design.badge('success')),
    design.row('Cost', `$${(result.runs.reduce((acc, r) => acc + r.cost_cents, 0) / 100).toFixed(2)}`),
    design.section('TEAM NOTES'),
    ...notes,
    design.divider()
  ];
  return {
    text: design.compose(lines),
    keyboard: design.keyboard([
      [design.textButton('Run Again', 'cc_pipeline_run')],
      [design.textButton('Today\'s Activity', 'cc_activity')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

function buildSalesFlow() {
  const { runSalesFlow } = require('../../agents/orchestrator');
  const result = runSalesFlow('The price is too high for our budget.', 'bot_sales');
  const lines = [
    `${design.EMOJI.ai} ${design.b('Sales Flow')}`,
    design.it('Orchestrator → Sales → Gatekeeper'),
    design.divider(),
    design.row('Objection', result.draft.objectionType),
    design.row('Gatekeeper', design.badge(result.review.decision === 'APPROVE' ? 'success' : 'warning')),
    design.row('Draft', design.code(result.draft.draft.slice(0, 80))),
    design.row('Route', result.routed ? result.routed.status : 'blocked'),
    design.divider()
  ];
  return {
    text: design.compose(lines),
    keyboard: design.keyboard([
      [design.textButton('Run Again', 'cc_sales_run')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

module.exports = { buildPipeline, buildPipelineResult, buildSalesFlow };
