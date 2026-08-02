const design = require('../design');
const audit = require('../../utils/auditLogger');
const { getStoreAdapter } = require('../store');
const learning = require('../../services/learning');
const runtime = require('../../services/workforce/runtime');
const botLearning = require('../learning');
const { getCtx } = require('./lib');

async function buildMissions(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Mission Center')}`,
        design.it('Set up a workspace to run missions.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const adapter = getStoreAdapter();
  const progress = await learning.progress(adapter, ctx.workspace.id);
  const missions = await runtime.listMissions(adapter, ctx.workspace.id);
  const missionLines = missions.length
    ? missions.slice(0, 8).map(m => {
      const status = m.status === 'waiting_approval' ? '🟡 awaiting your approval' : m.status === 'completed' ? '🟢 completed' : m.status === 'failed' ? '🔴 failed' : m.status === 'budget_exceeded' ? '🔴 budget exceeded' : '🟡 in flight';
      return `${design.b(m.title)}\n${design.it(status + ' · ' + m.progress + '% · ' + m.completed_steps + '/' + m.total_steps + ' steps')}`;
    })
    : [design.it('No missions yet — start Mission 1 below.')];
  const rows = [];
  if (progress.complete) {
    rows.push([design.textButton('Mission 1 · Sell TEOS Dealmaker', 'cc_mission1'), design.textButton('Mission 2 · Revenue Pipeline', 'cc_mission2')]);
    rows.push([design.textButton('New Custom Mission', 'cc_mission_goal')]);
  } else {
    rows.push([design.textButton('Complete Mission 0 · Learn First', 'cc_learn')]);
  }
  if (missions.length) {
    const missionRows = missions.slice(0, 8).map(m => [design.textButton(`#${m.id} ${m.title.slice(0, 22)}`, `cc_mission:${m.id}`)]);
    rows.push(...missionRows);
  }
  rows.push([design.textButton('Approvals', 'cc_approvals'), design.textButton('Back to Home', 'cc_home')]);
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Mission Center')}`,
    design.it('Every mission starts with the Revenue Strategist: it decides if the mission makes sense, picks the specialists, sets success criteria and a budget, and asks for human approval before anything ships.'),
    design.divider(),
    design.section('YOUR MISSIONS'),
    ...missionLines,
    design.divider()
  ]);
  return { text, keyboard: design.keyboard(rows) };
}

async function buildMissionDetail(userId, planId) {
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel('No workspace', 'Provision a workspace first.').text, keyboard: null };
  const adapter = getStoreAdapter();
  const repos = require('../../db/repos').createRepos(adapter);
  const plan = await repos.plans.get(ctx.workspace.id, Number(planId));
  if (!plan) return { text: design.errorPanel('Mission not found', String(planId)).text, keyboard: null };
  const steps = await repos.planSteps.list(ctx.workspace.id, Number(planId));
  const stepLines = steps.map(s => {
    const tone = s.status === 'completed' ? '🟢' : s.status === 'awaiting_approval' ? '🟡' : s.status === 'failed' ? '🔴' : s.status === 'skipped' ? '⚪' : '▽';
    const out = s.status === 'completed' && s.output ? `\n${design.it(String(s.output).split('\n')[0].slice(0, 80))}` : '';
    return `${tone} ${design.b(s.agent_type)} · ${s.step_key}${out}`;
  });
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Mission #' + plan.id + ' · ' + plan.title)}`,
    design.it(plan.goal),
    design.divider(),
    design.row('Status', design.badge(plan.status === 'completed' ? 'success' : plan.status === 'waiting_approval' ? 'warning' : 'info')),
    design.row('Priority', String(plan.priority || 'normal')),
    design.row('Cost', `$${(((plan.metrics && plan.metrics.total_cost_cents) || 0) / 100).toFixed(2)}`),
    design.section('STEPS'),
    ...stepLines,
    design.divider()
  ]);
  const rows = [];
  if (plan.status === 'waiting_approval') rows.push([design.textButton('Review Approval', 'cc_approvals')]);
  if (plan.status === 'running' || plan.status === 'planned' || plan.status === 'paused') {
    rows.push([
      design.textButton(plan.status === 'paused' ? 'Resume' : 'Pause', `cc_mission_${plan.status === 'paused' ? 'resume' : 'pause'}:${plan.id}`)
    ]);
  }
  rows.push([design.textButton('Missions', 'cc_missions'), design.textButton('Back to Home', 'cc_home')]);
  return { text, keyboard: design.keyboard(rows) };
}

async function buildApprovals(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Approvals')}`,
        design.it('Set up a workspace first.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const adapter = getStoreAdapter();
  const repos = require('../../db/repos').createRepos(adapter);
  const pending = await repos.approvals.list(ctx.workspace.id, 'pending');
  const planCache = {};
  const lines = pending.length
    ? pending.map(a => {
      let title = a.agent_type;
      if (a.plan_id) {
        if (!planCache[a.plan_id]) planCache[a.plan_id] = repos.plans.get(ctx.workspace.id, a.plan_id);
        const p = planCache[a.plan_id];
        if (p) title = p.title;
      }
      return `${design.EMOJI.warning} ${design.b(title)}\n${design.it((a.reason || '').slice(0, 120))}`;
    })
    : [design.it('No pending approvals.')];
  const rows = [];
  if (pending.length) {
    const apprRows = pending.map(a => [design.textButton(`Approve #${a.id}`, `cc_appr:${a.id}:approve`), design.textButton(`Reject #${a.id}`, `cc_appr:${a.id}:reject`)]);
    rows.push(...apprRows);
  }
  rows.push([design.textButton('Missions', 'cc_missions'), design.textButton('Back to Home', 'cc_home')]);
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b('Approvals')}`,
    design.it('Missions pause here until you decide — nothing is sent, created or issued without your approval.'),
    design.divider(),
    ...lines,
    design.divider()
  ]);
  return { text, keyboard: design.keyboard(rows) };
}

async function buildMissionGoalPrompt() {
  return {
    text: design.compose([
      `${design.EMOJI.ai} ${design.b('New Mission')}`,
      design.divider(),
      design.it('Type your mission goal. The Revenue Strategist will decide whether it makes sense and which specialists to deploy.'),
      design.it('Examples:'),
      design.code('Research our top competitors and explain how we win.'),
      design.code('Build an outreach sequence for fintech founders in the US.'),
      design.code('Prepare a pricing strategy for our Enterprise plan.'),
      design.divider()
    ]),
    keyboard: design.keyboard([
      [design.textButton('Cancel', 'cc_missions')]
    ])
  };
}

async function buildMissionRunResult(userId, planId, extra) {
  const ctx = await getCtx(userId);
  const adapter = getStoreAdapter();
  const repos = require('../../db/repos').createRepos(adapter);
  const plan = await repos.plans.get(ctx.workspace.id, planId);
  const steps = await repos.planSteps.list(ctx.workspace.id, planId);
  const status = plan ? plan.status : 'completed';
  const stepLines = steps.map(s => {
    const tone = s.status === 'completed' ? '🟢' : s.status === 'awaiting_approval' ? '🟡' : s.status === 'failed' ? '🔴' : '▽';
    const out = s.status === 'completed' && s.output ? `\n${design.it(String(s.output).split('\n')[0].slice(0, 80))}` : '';
    return `${tone} ${design.b(s.agent_type)} · ${s.step_key}${out}`;
  });
  const strategyBlock = extra && extra.strategy
    ? `\n\n${design.code(extra.strategy.ascii)}`
    : '';
  const lines = [
    `${design.EMOJI.ai} ${design.b('Mission Launched')}`,
    design.it(plan ? plan.title : 'Mission'),
    design.divider(),
    ...stepLines,
    design.section('STATUS'),
    design.row('State', design.badge(status === 'completed' ? 'success' : status === 'waiting_approval' ? 'warning' : 'info')),
    ...(status === 'waiting_approval' ? [design.it('The mission paused for your approval — review it in Approvals.')] : []),
    strategyBlock,
    design.divider()
  ];
  const rows = [];
  if (status === 'waiting_approval') rows.push([design.textButton('Review Approval', 'cc_approvals')]);
  rows.push([design.textButton('Missions', 'cc_missions'), design.textButton('Back to Home', 'cc_home')]);
  return { text: design.compose(lines), keyboard: design.keyboard(rows) };
}

async function launchMission1(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel('No workspace', 'Provision a workspace first.').text, keyboard: null };
  const adapter = getStoreAdapter();
  const progress = await learning.progress(adapter, ctx.workspace.id);
  if (!progress.complete) {
    botLearning.begin(userId);
    const res = await botLearning.buildPrompt(userId, adapter, ctx.workspace.id);
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b('Mission 1 · Sell TEOS Dealmaker')}`,
        design.it('Step 1 of 10 — Learn your business. The revenue team builds your strategy, prospects and first outreach as soon as you answer.'),
        design.divider(),
        res.prompt
      ]),
      keyboard: res.keyboard
    };
  }
  try {
    const result = await runtime.runSalesStrategy(adapter, ctx.workspace.id, {});
    audit.writeEntry('BOT_MISSION1_RUN', String(userId), 'success', { planId: result.plan.id, status: result.status });
    return buildMissionRunResult(userId, result.plan.id, result);
  } catch (err) {
    audit.writeEntry('BOT_MISSION1_ERROR', String(userId), 'error', { error: err.message });
    throw err;
  }
}

async function launchMission2(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel('No workspace', 'Provision a workspace first.').text, keyboard: null };
  const adapter = getStoreAdapter();
  const progress = await learning.progress(adapter, ctx.workspace.id);
  if (!progress.complete) {
    return {
      text: design.compose([
        `${design.EMOJI.warning} ${design.b('Mission 2 is locked')}`,
        design.it('Complete Mission 0 first.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Continue Learning', 'cc_learn')],
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const result = await runtime.runGoal(adapter, ctx.workspace.id,
    'Run a full revenue pipeline for our target accounts: prospect, qualify, engage, propose and close deals for our known products.',
    { title: 'Revenue Pipeline', priority: 'high', budgetCents: 1200 });
  audit.writeEntry('BOT_MISSION2_RUN', String(userId), 'success', { planId: result.plan.id, status: result.status });
  return buildMissionRunResult(userId, result.plan.id, result);
}

async function launchMarketMission(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel('No workspace', 'Provision a workspace first.').text, keyboard: null };
  const adapter = getStoreAdapter();
  const result = await runtime.runGoal(adapter, ctx.workspace.id,
    'Analyze our target market: research the market, competitors, ideal customers and opportunity, then recommend where to focus.',
    { title: 'Analyze a Market', priority: 'high' });
  audit.writeEntry('BOT_MISSION_MARKET', String(userId), 'success', { planId: result.plan.id, status: result.status });
  return buildMissionRunResult(userId, result.plan.id, result);
}

async function launchGoalMission(userId, goal) {
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel('No workspace', 'Provision a workspace first.').text, keyboard: null };
  const adapter = getStoreAdapter();
  const result = await runtime.runGoal(adapter, ctx.workspace.id, goal, { title: goal.slice(0, 120), priority: 'high' });
  audit.writeEntry('BOT_MISSION_GOAL', String(userId), 'success', { planId: result.plan.id, status: result.status });
  return buildMissionRunResult(userId, result.plan.id, result);
}

module.exports = {
  buildMissions,
  buildMissionDetail,
  buildApprovals,
  buildMissionGoalPrompt,
  buildMissionRunResult,
  launchMission1,
  launchMission2,
  launchMarketMission,
  launchGoalMission
};
