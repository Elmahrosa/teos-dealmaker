const design = require('../design');
const i18n = require('../i18n');

// Stage names for the progress rail. Screen-local display copy. The workforce
// registry (services/workforce/registry.js) keeps its own separate English
// labels; translating this array does not touch it, and vice versa.
function pipelineStages(t) {
  return [
    t('pf_stage_strategist'),
    t('pf_stage_marketer'),
    t('pf_stage_negotiator'),
    t('pf_stage_treasurer'),
    t('pf_stage_closing')
  ];
}

// AGENT INPUT, deliberately English, never translated.
//
// This is not UI copy: it is the synthetic customer objection handed to
// runSalesFlow -> draftResponse -> generateResponse -> classifyObjection, whose
// classifier matches ENGLISH keywords (/price|cost|expensive|afford|budget/i).
// Translating it would silently stop matching and every run would degrade to
// the 'general' canned response, i.e. it would change agent behaviour rather
// than presentation. Same category as the missions.js runGoal allowlist and the
// /ask prompt in services/intelligence.js.
const SALES_OBJECTION = 'The price is too high for our budget.';

// The synthetic actor id passed as runSalesFlow's userId. Machine identity.
const SALES_ACTOR = 'bot_sales';

function buildPipeline(userId) {
  const t = key => i18n.t(userId, key);
  const stages = pipelineStages(t);
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('pf_title_hub'))}`,
    design.it(i18n.sprintf(t('pf_body_sub'), stages.length)),
    design.divider(),
    design.progressBar(stages, -1).join('\n'),
    design.divider(),
    design.it(t('pf_body_run'))
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton(t('pf_btn_run'), 'cc_pipeline_run')],
      [design.textButton(t('common_home'), 'cc_home')]
    ])
  };
}

function buildPipelineResult(userId, result) {
  const t = key => i18n.t(userId, key);
  const notes = (result.notes || []).map(n =>
    `${design.code(n.agent_name)} ${n.note}`
  );
  const c = result.treasurer.contract;
  const lines = [
    `${design.EMOJI.ai} ${design.b(t('pf_title_run'))}`,
    design.it(t('pf_body_chain')),
    design.divider(),
    design.row(t('pf_row_strategy'), result.strategy.style),
    design.row(t('pf_row_positioning'), result.marketing.headline),
    design.row(t('pf_row_landing'), `$${result.negotiation.landingPrice}`),
    design.row(t('pf_row_terms'), result.negotiation.suggestedTerms),
    design.row(t('pf_row_contract'), i18n.sprintf(t('pf_contract_line'), c.company, c.amount, c.currency, c.termMonths)),
    design.row(t('pf_row_checkout'), result.treasurer.checkout ? result.treasurer.checkout.url : t('pf_val_blocked')),
    design.row(t('pf_row_gatekeeper'), design.badge(result.gatekeeper.decision === 'APPROVE' ? 'success' : 'warning')),
    design.row(t('pf_row_outcome'), design.badge(result.closing.status === 'won' ? 'success' : 'critical')),
    design.row(t('pf_row_deal_saved'), design.badge('success')),
    design.row(t('pf_row_cost'), `$${(result.runs.reduce((acc, r) => acc + r.cost_cents, 0) / 100).toFixed(2)}`),
    design.section(t('pf_sec_notes')),
    ...notes,
    design.divider()
  ];
  return {
    text: design.compose(lines),
    keyboard: design.keyboard([
      [design.textButton(t('pf_btn_run_again'), 'cc_pipeline_run')],
      [design.textButton(t('pf_btn_activity'), 'cc_activity')],
      [design.textButton(t('common_home'), 'cc_home')]
    ])
  };
}

function buildSalesFlow(userId) {
  const t = key => i18n.t(userId, key);
  const { runSalesFlow } = require('../../agents/orchestrator');
  const result = runSalesFlow(SALES_OBJECTION, SALES_ACTOR);
  const lines = [
    `${design.EMOJI.ai} ${design.b(t('pf_title_salesflow'))}`,
    design.it(t('pf_body_saleschain')),
    design.divider(),
    design.row(t('pf_row_objection'), result.draft.objectionType),
    design.row(t('pf_row_gatekeeper'), design.badge(result.review.decision === 'APPROVE' ? 'success' : 'warning')),
    design.row(t('pf_row_draft'), design.code(result.draft.draft.slice(0, 80))),
    design.row(t('pf_row_route'), result.routed ? result.routed.status : t('pf_val_blocked')),
    design.divider()
  ];
  return {
    text: design.compose(lines),
    keyboard: design.keyboard([
      [design.textButton(t('pf_btn_run_again'), 'cc_sales_run')],
      [design.textButton(t('common_home'), 'cc_home')]
    ])
  };
}

module.exports = { buildPipeline, buildPipelineResult, buildSalesFlow };
