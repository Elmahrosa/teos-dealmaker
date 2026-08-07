const design = require('../design');
const audit = require('../../utils/auditLogger');
const { getStoreAdapter } = require('../store');
const learning = require('../../services/learning');
const runtime = require('../../services/workforce/runtime');
const botLearning = require('../learning');
const identity = require('../../services/identity');
const missionState = require('../missionState');
const { isFounder } = require('../access');
const { getCtx } = require('./lib');

const MISSION_FORM_STEPS = [
  { key: 'name', label: 'Mission Name', hint: 'Give the mission a short name, e.g. Sell TEOS DealMaker' },
  { key: 'goal', label: 'Mission Goal', hint: 'What should the revenue team achieve? Be specific.' },
  { key: 'customer', label: 'Target Customer', hint: 'Who is the target customer? e.g. Elmahrosa International' },
  { key: 'market', label: 'Target Market', hint: 'Which market? e.g. AI Security' },
  { key: 'priority', label: 'Priority', hint: 'normal, high or urgent' },
  { key: 'revenue', label: 'Expected Revenue', hint: 'Expected revenue, e.g. $50,000' },
  { key: 'deadline', label: 'Deadline', hint: 'Deadline, e.g. 24 hours or 2026-08-15' },
  { key: 'notes', label: 'Notes', hint: 'Any extra notes for the revenue team' }
];

function cancelKeyboard() {
  return design.keyboard([[design.textButton('Cancel', 'cc_mission_form_cancel')]]);
}

async function buildMissionCreatePrompt(userId) {
  const payload = missionState.payload(userId) || {};
  const mission = payload.mission || {};
  const stepIndex = payload.step ? MISSION_FORM_STEPS.findIndex(s => s.key === payload.step) : 0;
  const step = stepIndex >= 0 ? MISSION_FORM_STEPS[stepIndex] : null;
  if (!step) return buildMissions(userId);
  const summary = MISSION_FORM_STEPS
    .filter(s => mission[s.key])
    .map(s => design.it(`${s.label}: ${mission[s.key]}`));
  return {
    text: design.compose([
      `${design.EMOJI.ai} ${design.b('Create Mission')}`,
      design.it('Answer the prompts — the Revenue Strategist runs the full governed workflow and halts for your approval before anything ships.'),
      design.divider(),
      design.section(`${stepIndex + 1} of ${MISSION_FORM_STEPS.length} · ${step.label}`),
      design.it(step.hint),
      ...(summary.length ? [design.section('SO FAR'), ...summary] : []),
      design.divider()
    ]),
    keyboard: cancelKeyboard()
  };
}

async function handleMissionCreateText(chatId, userId, text) {
  const payload = missionState.payload(userId) || {};
  const mission = payload.mission || {};
  const stepIndex = payload.step ? MISSION_FORM_STEPS.findIndex(s => s.key === payload.step) : 0;
  const step = stepIndex >= 0 ? MISSION_FORM_STEPS[stepIndex] : null;
  if (!step) {
    missionState.clear(userId);
    return { chatId, text: design.it('Mission form is out of sync — start over.'), replyMarkup: cancelKeyboard() };
  }

  const value = String(text || '').trim();
  if (step.key === 'priority') {
    const normalized = value.toLowerCase();
    if (!['normal', 'high', 'urgent'].includes(normalized)) {
      return {
        chatId,
        text: design.compose([
          design.it('Priority must be <b>normal</b>, <b>high</b> or <b>urgent</b>. Try again.')
        ]),
        replyMarkup: cancelKeyboard()
      };
    }
    mission[step.key] = normalized;
  } else {
    mission[step.key] = value;
  }

  const nextIndex = stepIndex + 1;
  if (nextIndex >= MISSION_FORM_STEPS.length) {
    missionState.clear(userId);
    const adapter = getStoreAdapter();
    const user = await identity.getUserByTelegram(adapter, userId);
    const workspace = user ? await identity.getWorkspaceForUser(adapter, user.id) : null;
    if (!workspace) {
      return { chatId, text: 'No workspace found. Run /start to provision one.' };
    }
    const goalText = [
      `Mission: ${mission.name}`,
      mission.goal,
      `Target customer: ${mission.customer}`,
      `Target market: ${mission.market}`,
      `Expected revenue: ${mission.revenue}`,
      `Deadline: ${mission.deadline}`,
      mission.notes ? `Notes: ${mission.notes}` : null
    ].filter(Boolean).join('\n');
    const result = await runtime.runGoal(adapter, workspace.id, goalText, {
      title: mission.name || 'New Mission',
      priority: mission.priority || 'high',
      intent: 'deal'
    });
    const repos = require('../../db/repos').createRepos(adapter);
    await repos.plans.update(workspace.id, result.plan.id, {
      metrics: {
        ...(result.plan.metrics || {}),
        mission: {
          name: mission.name,
          goal: mission.goal,
          target_customer: mission.customer,
          target_market: mission.market,
          priority: mission.priority,
          expected_revenue: mission.revenue,
          deadline: mission.deadline,
          notes: mission.notes
        }
      }
    });
    audit.writeEntry('BOT_MISSION_CREATE', String(userId), 'success', {
      planId: result.plan.id,
      status: result.status,
      mission: mission.name
    });
    const sc = await buildMissionRunResult(userId, result.plan.id, result);
    return { chatId, text: sc.text, replyMarkup: sc.keyboard };
  }

  missionState.begin(userId, { mode: 'mission_create', step: MISSION_FORM_STEPS[nextIndex].key, mission });
  const sc = await buildMissionCreatePrompt(userId);
  return { chatId, text: sc.text, replyMarkup: sc.keyboard };
}

function extractRevenue(output) {
  const amounts = String(output || '').match(/\$\s?[\d,.]+[kKmM]?/g);
  return amounts ? amounts[0] : '—';
}

async function buildMissionDashboard(userId) {
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.target} ${design.b('Mission Dashboard')}`,
        design.it('Provision a workspace to view the dashboard.'),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton('Back to Home', 'cc_home')]
      ])
    };
  }
  const adapter = getStoreAdapter();
  const repos = require('../../db/repos').createRepos(adapter);
  const missions = await runtime.listMissions(adapter, ctx.workspace.id);
  const plans = await repos.plans.list(ctx.workspace.id);
  let steps = [];
  for (const plan of plans) {
    const planSteps = await repos.planSteps.list(ctx.workspace.id, plan.id);
    steps = steps.concat(planSteps.map(s => ({ ...s, plan_title: plan.title })));
  }
  const completed = steps.filter(s => s.status === 'completed');
  const failed = steps.filter(s => s.status === 'failed');
  const leads = completed.filter(s => ['prospects', 'accounts'].includes(s.step_key)).length;
  const qualified = completed.filter(s => s.step_key === 'qualify').length;
  const emails = completed.filter(s => s.step_key === 'outreach_email').length;
  const messages = completed.filter(s => s.step_key === 'outreach_linkedin').length;
  const proposals = completed.filter(s => s.step_key === 'proposal').length;
  const meetings = completed.filter(s => s.step_key === 'meetings').length;
  const followups = completed.filter(s => s.step_key === 'followups').length;
  const conversion = leads ? Math.round((qualified / leads) * 100) : 0;
  const forecastStep = completed.find(s => s.step_key === 'forecast');
  const revenueForecast = forecastStep ? extractRevenue(forecastStep.output) : '—';

  const byAgent = {};
  for (const s of steps) {
    if (!byAgent[s.agent_type]) byAgent[s.agent_type] = { total: 0, done: 0 };
    byAgent[s.agent_type].total += 1;
    if (s.status === 'completed') byAgent[s.agent_type].done += 1;
  }
  const agentUtil = Object.entries(byAgent)
    .map(([agent, v]) => `${agent} ${v.total ? Math.round((v.done / v.total) * 100) : 0}%`);

  const active = missions.filter(m => ['planned', 'running', 'waiting_approval'].includes(m.status));
  const avgProgress = missions.length ? Math.round(missions.reduce((a, m) => a + m.progress, 0) / missions.length) : 0;
  let auditCount = 0;
  try { auditCount = await repos.audit.count(ctx.workspace.id); } catch (_) { /* best-effort */ }
  const awaiting = missions.find(m => m.status === 'waiting_approval');
  const nextMission = missions.find(m => !['completed', 'failed', 'cancelled'].includes(m.status));
  const recommendation = awaiting
    ? `Approve "${awaiting.title}" — it is paused waiting for you.`
    : nextMission && nextMission.next_action
      ? `${nextMission.title} · next: ${nextMission.next_agent} — ${String(nextMission.next_action).slice(0, 100)}`
      : missions.length
        ? 'All missions settled — create a new mission to keep the pipeline moving.'
        : 'Create your first mission to start the revenue workflow.';

  const text = design.compose([
    `${design.EMOJI.target} ${design.b('Mission Dashboard')}`,
    design.it('Founder view — every mission, pipeline and approval in one place.'),
    design.divider(),
    design.section('MISSIONS'),
    design.row('Total', String(missions.length)),
    design.row('In flight', String(active.length)),
    design.row('Completed', String(missions.filter(m => m.status === 'completed').length)),
    design.row('Awaiting approval', String(missions.filter(m => m.status === 'waiting_approval').length)),
    design.row('Avg progress', avgProgress + '%'),
    design.section('REVENUE WORKFLOW'),
    design.row('Leads found', String(leads)),
    design.row('Qualified', String(qualified)),
    design.row('Conversion rate', conversion + '%'),
    design.row('Emails drafted', String(emails)),
    design.row('LinkedIn messages', String(messages)),
    design.row('Proposals drafted', String(proposals)),
    design.row('Meetings planned', String(meetings)),
    design.row('Follow-ups designed', String(followups)),
    design.row('Revenue forecast', String(revenueForecast)),
    design.section('WORKFORCE'),
    agentUtil.length ? design.list(agentUtil.slice(0, 8)) : design.it('No agent activity yet.'),
    design.section('HEALTH'),
    design.row('Failed steps', String(failed.length)),
    design.row('Audit entries', String(auditCount)),
    design.section('RECOMMENDATION'),
    design.it(recommendation),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton('Create Mission', 'cc_mission_create'), design.textButton('Approvals', 'cc_approvals')],
      [design.textButton('Missions', 'cc_missions'), design.textButton('Back to Home', 'cc_home')]
    ])
  };
}

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
  if (progress.complete || isFounder(userId)) {
    rows.push([design.textButton('Mission 1 · Sell TEOS Dealmaker', 'cc_mission1'), design.textButton('Mission 2 · Revenue Pipeline', 'cc_mission2')]);
    rows.push([design.textButton('New Custom Mission', 'cc_mission_goal')]);
  } else {
    rows.push([design.textButton('Complete Mission 0 · Learn First', 'cc_learn')]);
  }
  if (missions.length) {
    const missionRows = missions.slice(0, 8).map(m => [design.textButton(`#${m.id} ${m.title.slice(0, 22)}`, `cc_mission:${m.id}`)]);
    rows.push(...missionRows);
  }
  if (isFounder(userId)) {
    rows.push([design.textButton('📊 Mission Dashboard', 'cc_mission_dashboard'), design.textButton('➕ Create Mission', 'cc_mission_create')]);
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
  if (plan.status === 'running' || plan.status === 'planned') {
    const completedSteps = steps.filter(s => s.status === 'completed').length;
    if (completedSteps === 0) {
      rows.push([design.textButton('▶ Start Mission', `cc_mission_run:${plan.id}`)]);
    }
  }
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
  if (!progress.complete && !isFounder(userId)) {
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
  if (!progress.complete && !isFounder(userId)) {
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
  buildMissionCreatePrompt,
  buildMissionDashboard,
  handleMissionCreateText,
  launchMission1,
  launchMission2,
  launchMarketMission,
  launchGoalMission
};
