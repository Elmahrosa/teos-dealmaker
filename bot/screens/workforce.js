const design = require('../design');
const { getStoreAdapter } = require('../store');
const workforce = require('../../services/workforce');
const { getCtx, workforceStatus } = require('./lib');

async function buildWorkforce(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('My Revenue Team')}`,
        design.it('Set up a workspace to see your workforce.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const view = await workforce.workforceConsole(getStoreAdapter(), ctx.workspace.id);
  const statusLine = (a) => `${design.EMOJI[a.tone]} ${a.label} · ${a.display}`;
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('My Revenue Team')}`,
    design.it(`${view.workers_total} Specialists · ${view.busy} Busy · ${view.ready} Ready`),
    design.divider(),
    design.row('��⚡ Today\'s Cost', `$${(view.today_cost_cents / 100).toFixed(2)}`),
    design.row('��✓ Completed Tasks', String(view.completed_tasks)),
    ...(view.estimated_pipeline_cents != null && view.estimated_pipeline_cents !== 0 ? [design.row('���💰 Estimated Pipeline', `$${(view.estimated_pipeline_cents / 100).toFixed(2)}`)] : []),
    design.section('WORKFORCE'),
    ...view.agents.map(a => statusLine(a)),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Today\'s Activity', 'cc_activity'), design.textButton('Timeline', 'cc_timeline')],
      [design.textButton('Costs', 'cc_costs'), design.textButton('Health', 'cc_health')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

async function buildActivity(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Today\'s Activity')}`,
        design.it('Set up a workspace to see activity.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const today = await workforce.todayActivity(getStoreAdapter(), ctx.workspace.id);
  const lines = today.flatMap(a => {
    const line = a.runs > 0
      ? `${design.EMOJI.success} ${a.label} · ${a.runs} run${a.runs === 1 ? '' : 's'}`
      : `${design.EMOJI.info} ${a.label} · waiting`;
    const detail = a.last_output ? `\n${design.it(String(a.last_output))}` : '';
    return [`${line}${detail}`];
  });
  const total = today.reduce((acc, a) => acc + a.runs, 0);
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Today\'s Activity')}`,
    design.it(`${total} agent run${total === 1 ? '' : 's'} so far`),
    design.divider(),
    ...lines,
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

async function buildAgentDetail(userId, agentType) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return { text: design.errorPanel('No workspace', 'Provision a workspace first.').text, keyboard: null };
  }
  const view = await workforce.getWorkforceView(getStoreAdapter(), ctx.workspace.id);
  const agent = view.agents.find(a => a.agent_type === agentType);
  if (!agent) {
    return { text: design.errorPanel('Agent not found', agentType).text, keyboard: null };
  }
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(agent.label)}`,
    design.it(agent.role),
    design.divider(),
    design.row('Status', workforceStatus(agent)),
    design.row('Runs today', String(agent.today_runs)),
    design.row('Total runs', String(agent.total_runs)),
    design.row('Last run', workforce.shortTime(agent.last_run_at)),
    design.row('Next run', workforce.shortTime(agent.next_run_at)),
    design.row('Provider', agent.provider || 'not configured'),
    design.row('Model', agent.model || '—'),
    design.row('Cost', `$${(agent.total_cost_cents / 100).toFixed(2)}`),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Back to Workforce', 'cc_workforce')],
      [design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

module.exports = { buildWorkforce, buildActivity, buildAgentDetail };
