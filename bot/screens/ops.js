const design = require('../design');
const audit = require('../../utils/auditLogger');
const { getStoreAdapter } = require('../store');
const workforce = require('../../services/workforce');
const queue = require('../../services/queue');
const { executiveBriefing } = require('../../services/briefing');
const { getCtx } = require('./lib');

async function buildHealth(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Platform Health')}`,
        design.it('Set up a workspace to see health.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const checks = await workforce.healthCheck(getStoreAdapter(), ctx.workspace.id, audit.readVault().length);
  const health = await workforce.agentHealth(getStoreAdapter(), ctx.workspace.id);
  const agentLines = health.map(h => {
    const tone = h.display === 'Ready' ? 'success' : h.display === 'Busy' ? 'warning' : h.display === 'Failed' ? 'critical' : 'info';
    const detail = h.success_pct !== null ? ` · ${h.success_pct}% ok · ${h.avg_runtime_ms} ms` : '';
    return `${design.EMOJI[tone]} ${h.label} · ${h.display}${detail}`;
  });
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Platform Health')}`,
    design.it('System status'),
    design.divider(),
    ...checks.map(ch => design.row(ch.label, `${ch.ok ? design.EMOJI.success : design.EMOJI.warning} ${ch.detail}`)),
    design.section('AGENT HEALTH'),
    ...agentLines,
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('My Revenue Team', 'cc_workforce')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildQueue(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Progress')}`,
        design.it('Set up a workspace to see the queue.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const snap = await queue.queueSnapshot(getStoreAdapter(), ctx.workspace.id);
  const movements = await queue.queueMovements(getStoreAdapter(), ctx.workspace.id, 6);
  const stageLines = snap.stages.map(s => {
    const tone = s.count > 0 ? 'warning' : 'info';
    return design.row(`${s.label}`, `${design.EMOJI[tone]} ${s.count}`);
  });
  const movementLines = movements.map(m =>
    `${design.code((m.created_at || '').slice(11, 19))} ${m.company}: ${m.from_stage} → ${m.to_stage}`
  );
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Progress')}`,
    design.it(`${snap.total} deal${snap.total === 1 ? '' : 's'} in pipeline`),
    design.divider(),
    ...stageLines,
    design.section('RECENT MOVEMENT'),
    ...(movementLines.length ? movementLines : [design.it('No movement yet — run the pipeline demo.')]),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Run Pipeline Demo', 'cc_pipeline_run'), design.textButton('Daily Summary', 'cc_briefing')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildBriefing(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Daily Summary')}`,
        design.it('Set up a workspace to see the briefing.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const b = await executiveBriefing(getStoreAdapter(), ctx.workspace.id);
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Executive Briefing')}`,
    design.it(b.date),
    design.divider(),
    design.section('YESTERDAY'),
    design.row('Prospects', String(b.yesterday.prospects)),
    design.row('Qualified', String(b.yesterday.qualified)),
    design.row('Emails sent', String(b.yesterday.emails)),
    design.row('Proposals', String(b.yesterday.proposals)),
    design.section('TODAY'),
    design.row('Opportunities', String(b.today_opportunities)),
    design.row('Open deals', String(b.open_deals)),
    design.row('Pipeline value', `$${(b.pipeline_value_cents / 100).toFixed(2)}`),
    design.row('Meetings needed', String(b.meetings_needed)),
    design.section('FORECAST'),
    design.row('Revenue forecast', `$${(b.revenue_forecast_cents / 100).toFixed(2)}`),
    design.section('ATTENTION'),
    ...(b.high_risk_deals.length
      ? b.high_risk_deals.map(d => design.it(`⚠ ${d.company} stalled in ${d.stage} (${d.days} days)`))
      : [design.it('No stalled deals.')]),
    design.section('RECOMMENDED ACTION'),
    design.it(b.recommended_action),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Progress', 'cc_queue'), design.textButton('Costs', 'cc_costs')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

module.exports = { buildHealth, buildQueue, buildBriefing };
