const design = require('../design');
const audit = require('../../utils/auditLogger');
const { getStoreAdapter } = require('../store');
const workforce = require('../../services/workforce');
const { getCtx, titleCase } = require('./lib');

async function buildDeals(userId) {
  const ctx = await getCtx(userId);
  const entries = audit.readVault();
  const closed = ctx
    ? ctx.deals.closed
    : entries.filter(e => e.action === 'CLOSING_AGENT_DEAL_CLOSED').length;
  const dbConfigured = Boolean(process.env.DATABASE_URL);
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Deals')}`,
    design.it('Deal ledger'),
    design.divider(),
    design.row('Open', ctx ? String(ctx.deals.open) : '—'),
    design.row('Closed', `${closed}`),
    design.row('Persistence', dbConfigured ? design.badge('success') : design.badge('warning') + ' ' + design.it('Postgres not configured')),
    design.section('NOTES'),
    design.it('Run the pipeline demo to record a deal through Strategist → Closing.'),
    design.it(dbConfigured
      ? 'Postgres persistence active via DATABASE_URL.'
      : 'Set DATABASE_URL and run `npm run db:migrate` to persist deals.')
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Run Pipeline Demo', 'cc_pipeline_run')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildTimeline(userId, dealId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Deal Timeline')}`,
        design.it('Set up a workspace to see the timeline.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const repos = require('../../db/repos').createRepos(getStoreAdapter());
  if (dealId) {
    const tl = await workforce.dealTimeline(getStoreAdapter(), ctx.workspace.id, Number(dealId));
    if (!tl) {
      return {
        text: design.compose([
          `${design.EMOJI.ai} ${design.b('Deal Timeline')}`,
          design.it('Deal not found.'),
          design.divider()
        ]),
        keyboard: design.keyboard([
          [design.textButton('All Deals', 'cc_timeline')],
          [design.textButton('Back to Home', 'cc_home')]
        ])
      };
    }
    const rows = [
      ...tl.notes.map(n => `${design.code(n.time ? workforce.shortTime(n.time) : '—')} ${design.b(titleCase(n.agent_name))} ${n.text}`),
      ...tl.events.map(e => `${design.code(e.time ? workforce.shortTime(e.time) : '—')} ${design.it('Stage')} ${e.text}`)
    ];
    const text = design.compose([
      `${design.EMOJI.ai} ${design.b('Deal Timeline')}`,
      design.it(`#${tl.deal.id} · ${tl.deal.company_name} · ${tl.deal.stage}`),
      design.divider(),
      ...rows,
      design.divider()
    ]);
    return {
      text,
      keyboard: design.keyboard([
        [design.textButton('All Deals', 'cc_timeline')],
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const deals = await repos.deals.list(ctx.workspace.id, {});
  const recent = deals.slice(0, 3);
  const blocks = recent.length ? (await Promise.all(recent.map(async d => {
    const notes = await repos.dealNotes.list(ctx.workspace.id, d.id);
    return [
      `${design.b(`#${d.id} · ${d.company_name} · ${d.stage}`)}`,
      ...(notes.length ? notes.map(n => `${design.code('  ·')} ${design.b(titleCase(n.agent_name))} ${n.note}`) : [design.it('  no notes yet')])
    ];
  }))).flat() : [design.it('No deals yet — run the pipeline demo.')];
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Deal Timeline')}`,
    design.it('How the team collaborated on each deal.'),
    design.divider(),
    ...blocks,
    design.divider()
  ]);
  const keyboardRows = recent.map(d => [design.textButton(`Deal #${d.id}`, `cc_timeline_deal:${d.id}`)]);
  keyboardRows.push([design.textButton('My Revenue Team', 'cc_workforce'), design.textButton('Back to Home', 'cc_home')]);
  return {
    text,
    keyboard: design.keyboard(keyboardRows)
  };
}

module.exports = { buildDeals, buildTimeline };
