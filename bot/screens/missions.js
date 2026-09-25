const design = require('../design');
const i18n = require('../i18n');
const audit = require('../../utils/auditLogger');
const { getStoreAdapter } = require('../store');
const learning = require('../../services/learning');
const runtime = require('../../services/workforce/runtime');
const botLearning = require('../learning');
const identity = require('../../services/identity');
const missionState = require('../missionState');
const { isFounder } = require('../access');
const { getCtx } = require('./lib');

// Form step definitions carry i18n keys, not literal copy, so the label and
// hint can be resolved per-user at render time (labels are user-visible).
const MISSION_FORM_STEP_DEFS = [
  { key: 'name', labelKey: 'ms_f_name', hintKey: 'ms_f_name_h' },
  { key: 'goal', labelKey: 'ms_f_goal', hintKey: 'ms_f_goal_h' },
  { key: 'customer', labelKey: 'ms_f_customer', hintKey: 'ms_f_customer_h' },
  { key: 'market', labelKey: 'ms_f_market', hintKey: 'ms_f_market_h' },
  { key: 'priority', labelKey: 'ms_f_priority', hintKey: 'ms_f_priority_h' },
  { key: 'revenue', labelKey: 'ms_f_revenue', hintKey: 'ms_f_revenue_h' },
  { key: 'deadline', labelKey: 'ms_f_deadline', hintKey: 'ms_f_deadline_h' },
  { key: 'notes', labelKey: 'ms_f_notes', hintKey: 'ms_f_notes_h' }
];

function missionFormSteps(userId) {
  return MISSION_FORM_STEP_DEFS.map(s => ({
    key: s.key,
    label: i18n.t(userId, s.labelKey),
    hint: i18n.t(userId, s.hintKey)
  }));
}

function cancelKeyboard(userId) {
  return design.keyboard([[design.textButton(i18n.t(userId, 'ms_btn_cancel'), 'cc_mission_form_cancel')]]);
}

async function buildMissionCreatePrompt(userId) {
  const t = key => i18n.t(userId, key);
  const payload = missionState.payload(userId) || {};
  const mission = payload.mission || {};
  const steps = missionFormSteps(userId);
  const stepIndex = payload.step ? steps.findIndex(s => s.key === payload.step) : 0;
  const step = stepIndex >= 0 ? steps[stepIndex] : null;
  if (!step) return buildMissions(userId);
  const summary = steps
    .filter(s => mission[s.key])
    .map(s => design.it(i18n.sprintf(t('ms_form_entry'), s.label, mission[s.key])));
  return {
    text: design.compose([
      `${design.EMOJI.ai} ${design.b(t('ms_btn_create'))}`,
      design.it(t('ms_body_create')),
      design.divider(),
      design.section(i18n.sprintf(t('ms_form_progress'), stepIndex + 1, steps.length, step.label)),
      design.it(step.hint),
      ...(summary.length ? [design.section(t('ms_sec_so_far')), ...summary] : []),
      design.divider()
    ]),
    keyboard: cancelKeyboard(userId)
  };
}

async function handleMissionCreateText(chatId, userId, text) {
  const t = key => i18n.t(userId, key);
  const payload = missionState.payload(userId) || {};
  const mission = payload.mission || {};
  const steps = missionFormSteps(userId);
  const stepIndex = payload.step ? steps.findIndex(s => s.key === payload.step) : 0;
  const step = stepIndex >= 0 ? steps[stepIndex] : null;
  if (!step) {
    missionState.clear(userId);
    return { chatId, text: design.it(t('ms_body_sync_err')), replyMarkup: cancelKeyboard(userId) };
  }

  const value = String(text || '').trim();
  if (step.key === 'priority') {
    const normalized = value.toLowerCase();
    if (!['normal', 'high', 'urgent'].includes(normalized)) {
      return {
        chatId,
        text: design.compose([
          design.it(t('ms_body_priority_err'))
        ]),
        replyMarkup: cancelKeyboard(userId)
      };
    }
    mission[step.key] = normalized;
  } else {
    mission[step.key] = value;
  }

  const nextIndex = stepIndex + 1;
  if (nextIndex >= steps.length) {
    missionState.clear(userId);
    const adapter = getStoreAdapter();
    const user = await identity.getUserByTelegram(adapter, userId);
    const workspace = user ? await identity.getWorkspaceForUser(adapter, user.id) : null;
    if (!workspace) {
      return { chatId, text: t('ms_body_no_workspace') };
    }
    // Agent-facing goal text is deliberately NOT localized: it is model input,
    // not UI copy, and the runtime prompts are English. Translating it would
    // change agent behaviour rather than presentation.
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
      title: mission.name || t('ms_title_new'),
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

  missionState.begin(userId, { mode: 'mission_create', step: steps[nextIndex].key, mission });
  const sc = await buildMissionCreatePrompt(userId);
  return { chatId, text: sc.text, replyMarkup: sc.keyboard };
}

function extractRevenue(output) {
  const amounts = String(output || '').match(/\$\s?[\d,.]+[kKmM]?/g);
  return amounts ? amounts[0] : '—';
}

async function buildMissionDashboard(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.target} ${design.b(t('ms_btn_dashboard'))}`,
        design.it(t('ms_body_dash_noctx')),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton(t('ms_btn_home'), 'cc_home')]
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
    ? i18n.sprintf(t('ms_rec_approve'), awaiting.title)
    : nextMission && nextMission.next_action
      ? i18n.sprintf(t('ms_rec_next'), nextMission.title, nextMission.next_agent, String(nextMission.next_action).slice(0, 100))
      : missions.length
        ? t('ms_rec_all_done')
        : t('ms_rec_none');

  const text = design.compose([
    `${design.EMOJI.target} ${design.b(t('ms_btn_dashboard'))}`,
    design.it(t('ms_body_dash')),
    design.divider(),
    design.section(t('ms_sec_missions')),
    design.row(t('ms_row_total'), String(missions.length)),
    design.row(t('ms_row_inflight'), String(active.length)),
    design.row(t('ms_row_completed'), String(missions.filter(m => m.status === 'completed').length)),
    design.row(t('ms_row_awaiting'), String(missions.filter(m => m.status === 'waiting_approval').length)),
    design.row(t('ms_row_avgprog'), avgProgress + '%'),
    design.section(t('ms_sec_revenue')),
    design.row(t('ms_row_leads'), String(leads)),
    design.row(t('ms_row_qualified'), String(qualified)),
    design.row(t('ms_row_conversion'), conversion + '%'),
    design.row(t('ms_row_emails'), String(emails)),
    design.row(t('ms_row_linkedin'), String(messages)),
    design.row(t('ms_row_proposals'), String(proposals)),
    design.row(t('ms_row_meetings'), String(meetings)),
    design.row(t('ms_row_followups'), String(followups)),
    design.row(t('ms_row_forecast'), String(revenueForecast)),
    design.section(t('ms_sec_workforce')),
    agentUtil.length ? design.list(agentUtil.slice(0, 8)) : design.it(t('ms_body_no_activity')),
    design.section(t('ms_sec_health')),
    design.row(t('ms_row_failed_steps'), String(failed.length)),
    design.row(t('ms_row_audit'), String(auditCount)),
    design.section(t('ms_sec_recommendation')),
    design.it(recommendation),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton(t('ms_btn_create'), 'cc_mission_create'), design.textButton(t('ms_btn_approvals'), 'cc_approvals')],
      [design.textButton(t('ms_btn_missions'), 'cc_missions'), design.textButton(t('ms_btn_home'), 'cc_home')]
    ])
  };
}

async function buildMissions(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b(t('ms_title_center'))}`,
        design.it(t('ms_body_center_noctx')),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton(t('ms_btn_home'), 'cc_home')]
      ])
    };
  }
  const adapter = getStoreAdapter();
  const progress = await learning.progress(adapter, ctx.workspace.id);
  const missions = await runtime.listMissions(adapter, ctx.workspace.id);
  const missionLines = missions.length
    ? missions.slice(0, 8).map(m => {
      const status = m.status === 'waiting_approval' ? t('ms_st_awaiting') : m.status === 'completed' ? t('ms_st_completed') : m.status === 'failed' ? t('ms_st_failed') : m.status === 'budget_exceeded' ? t('ms_st_budget') : t('ms_st_inflight');
      return `${design.b(m.title)}\n${design.it(status + i18n.sprintf(t('ms_steps_suffix'), m.progress, m.completed_steps, m.total_steps))}`;
    })
    : [design.it(t('ms_body_no_missions'))];
  const rows = [];
  if (progress.complete || isFounder(userId)) {
    rows.push([design.textButton(t('ms_btn_m1'), 'cc_mission1'), design.textButton(t('ms_btn_m2'), 'cc_mission2')]);
    rows.push([design.textButton(t('ms_btn_custom'), 'cc_mission_goal')]);
  } else {
    rows.push([design.textButton(t('ms_btn_m0'), 'cc_learn')]);
  }
  if (missions.length) {
    const missionRows = missions.slice(0, 8).map(m => [design.textButton(`#${m.id} ${m.title.slice(0, 22)}`, `cc_mission:${m.id}`)]);
    rows.push(...missionRows);
  }
  if (isFounder(userId)) {
    rows.push([design.textButton('📊 ' + t('ms_btn_dashboard'), 'cc_mission_dashboard'), design.textButton('➕ ' + t('ms_btn_create'), 'cc_mission_create')]);
  }
  rows.push([design.textButton(t('ms_btn_approvals'), 'cc_approvals'), design.textButton(t('ms_btn_home'), 'cc_home')]);
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('ms_title_center'))}`,
    design.it(t('ms_body_center')),
    design.divider(),
    design.section(t('ms_sec_your_missions')),
    ...missionLines,
    design.divider()
  ]);
  return { text, keyboard: design.keyboard(rows) };
}

async function buildMissionDetail(userId, planId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel(t('ms_err_no_workspace'), t('ms_err_provision_first')).text, keyboard: null };
  const adapter = getStoreAdapter();
  const repos = require('../../db/repos').createRepos(adapter);
  const plan = await repos.plans.get(ctx.workspace.id, Number(planId));
  if (!plan) return { text: design.errorPanel(t('ms_err_not_found'), String(planId)).text, keyboard: null };
  const steps = await repos.planSteps.list(ctx.workspace.id, Number(planId));
  const stepLines = steps.map(s => {
    const tone = s.status === 'completed' ? '🟢' : s.status === 'awaiting_approval' ? '🟡' : s.status === 'failed' ? '🔴' : s.status === 'skipped' ? '⚪' : '▽';
    const out = s.status === 'completed' && s.output ? `\n${design.it(String(s.output).split('\n')[0].slice(0, 80))}` : '';
    return `${tone} ${design.b(s.agent_type)} · ${s.step_key}${out}`;
  });
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(i18n.sprintf(t('ms_title_mission'), plan.id, plan.title))}`,
    design.it(plan.goal),
    design.divider(),
    design.row(t('ms_row_status'), design.badge(plan.status === 'completed' ? 'success' : plan.status === 'waiting_approval' ? 'warning' : 'info')),
    design.row(t('ms_row_priority'), String(plan.priority || 'normal')),
    design.row(t('ms_row_cost'), `$${(((plan.metrics && plan.metrics.total_cost_cents) || 0) / 100).toFixed(2)}`),
    design.section(t('ms_sec_steps')),
    ...stepLines,
    design.divider()
  ]);
  const rows = [];
  if (plan.status === 'waiting_approval') rows.push([design.textButton(t('ms_btn_review'), 'cc_approvals')]);
  if (plan.status === 'running' || plan.status === 'planned') {
    const completedSteps = steps.filter(s => s.status === 'completed').length;
    if (completedSteps === 0) {
      rows.push([design.textButton('▶ ' + t('ms_btn_start'), `cc_mission_run:${plan.id}`)]);
    }
  }
  if (plan.status === 'running' || plan.status === 'planned' || plan.status === 'paused') {
    rows.push([
      design.textButton(plan.status === 'paused' ? t('ms_btn_resume') : t('ms_btn_pause'), `cc_mission_${plan.status === 'paused' ? 'resume' : 'pause'}:${plan.id}`)
    ]);
  }
  rows.push([
    design.textButton(t('ms_btn_exec'), `cc_mission_report:${plan.id}`),
    design.textButton(t('ms_btn_kpis'), `cc_mission_kpis:${plan.id}`)
  ]);
  rows.push([design.textButton(t('ms_btn_missions'), 'cc_missions'), design.textButton(t('ms_btn_home'), 'cc_home')]);
  return { text, keyboard: design.keyboard(rows) };
}

async function buildMissionReport(userId, planId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel(t('ms_err_no_workspace'), t('ms_err_provision_first')).text, keyboard: null };
  const adapter = getStoreAdapter();
  const missionReportSvc = require('../../services/missionReport');
  const report = await missionReportSvc.missionReport(adapter, ctx.workspace.id, Number(planId));
  if (!report) return { text: design.errorPanel(t('ms_err_not_found'), String(planId)).text, keyboard: null };
  const { plan, timeline, kpis, agents } = report;
  const money = cents => `$${(((cents || 0)) / 100).toFixed(2)}`;
  const timelineLines = timeline.length
    ? timeline.slice(0, 14).map(s => {
      const tone = s.status === 'completed' ? '🟢' : s.status === 'failed' ? '🔴' : s.status === 'awaiting_approval' ? '🟡' : '▽';
      const when = (s.completed_at || s.started_at || '').slice(11, 16) || '';
      return `${tone} ${design.code(when || '—')} ${design.b(s.agent_type)} · ${s.step_key}${s.output ? '\n' + design.it(s.output.slice(0, 90)) : ''}`;
    })
    : [design.it(t('ms_body_no_steps'))];
  const agentLines = agents.map(a => i18n.sprintf(t('ms_agent_util'), a.agent_type, a.completed, a.total, a.utilization));
  const text = design.compose([
    `${design.EMOJI.target} ${design.b(t('ms_title_exec'))}`,
    design.it(i18n.sprintf(t('ms_mission_ref'), plan.id, plan.title)),
    design.divider(),
    design.section(t('ms_sec_objective')),
    design.it(plan.goal),
    design.section(t('ms_sec_status')),
    design.row(t('ms_row_state'), design.badge(plan.status === 'completed' ? 'success' : plan.status === 'waiting_approval' ? 'warning' : 'info')),
    design.row(t('ms_row_completion'), `${kpis.completed_steps}/${kpis.total_steps} (${kpis.completion_rate}%)`),
    design.row(t('ms_row_success'), kpis.success_rate + '%'),
    design.row(t('ms_row_cost'), money(kpis.total_cost_cents)),
    design.row(t('ms_row_duration'), kpis.duration_ms === null ? '—' : (kpis.duration_ms / 1000).toFixed(1) + 's'),
    ...(kpis.revenue_cents !== null ? [design.row(t('ms_row_rev_identified'), money(kpis.revenue_cents))] : []),
    design.section(t('ms_sec_timeline')),
    ...timelineLines,
    design.section(t('ms_sec_workforce')),
    ...(agentLines.length ? agentLines : [design.it(t('ms_body_no_activity'))]),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton(t('ms_btn_kpis'), `cc_mission_kpis:${plan.id}`), design.textButton(t('ms_btn_detail'), `cc_mission:${plan.id}`)],
      [design.textButton(t('ms_btn_missions'), 'cc_missions'), design.textButton(t('ms_btn_home'), 'cc_home')]
    ])
  };
}

async function buildMissionKPIs(userId, planId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel(t('ms_err_no_workspace'), t('ms_err_provision_first')).text, keyboard: null };
  const adapter = getStoreAdapter();
  const missionReportSvc = require('../../services/missionReport');
  const report = await missionReportSvc.missionReport(adapter, ctx.workspace.id, Number(planId));
  if (!report) return { text: design.errorPanel(t('ms_err_not_found'), String(planId)).text, keyboard: null };
  const { plan, kpis } = report;
  const money = cents => `$${(((cents || 0)) / 100).toFixed(2)}`;
  const text = design.compose([
    `${design.EMOJI.target} ${design.b(t('ms_btn_kpis'))}`,
    design.it(i18n.sprintf(t('ms_mission_ref'), plan.id, plan.title)),
    design.divider(),
    design.section(t('ms_sec_output')),
    design.row(t('ms_row_completed'), String(kpis.completed_steps)),
    design.row(t('ms_row_failed'), String(kpis.failed_steps)),
    design.row(t('ms_row_skipped'), String(kpis.skipped_steps)),
    design.row(t('ms_row_awaiting'), String(kpis.awaiting_approval)),
    design.row(t('ms_row_completion_rate'), kpis.completion_rate + '%'),
    design.row(t('ms_row_success'), kpis.success_rate + '%'),
    design.section(t('ms_sec_quality')),
    design.row(t('ms_row_confidence'), kpis.avg_confidence === null ? '—' : kpis.avg_confidence.toFixed(2) + ' / 1.0'),
    design.section(t('ms_sec_economics')),
    design.row(t('ms_row_total_cost'), money(kpis.total_cost_cents)),
    design.row(t('ms_row_budget'), kpis.budget_cents === null ? '—' : money(kpis.budget_cents)),
    design.row(t('ms_row_budget_exceeded'), kpis.budget_exceeded ? t('ms_yes') : t('ms_no')),
    ...(kpis.revenue_cents !== null ? [design.row(t('ms_row_rev_identified'), money(kpis.revenue_cents))] : []),
    ...(kpis.expected_revenue_cents !== null ? [design.row(t('ms_row_expected_revenue'), money(kpis.expected_revenue_cents))] : []),
    design.row(t('ms_row_agents_used'), String(kpis.agents_used)),
    design.section(t('ms_sec_approvals')),
    design.row(t('ms_row_requested'), String(kpis.approvals_requested)),
    design.row(t('ms_row_pending'), String(kpis.approvals_pending)),
    design.divider()
  ]);
  return {
    text,
    keyboard: design.keyboard([
      [design.textButton(t('ms_btn_exec'), `cc_mission_report:${plan.id}`), design.textButton(t('ms_btn_detail'), `cc_mission:${plan.id}`)],
      [design.textButton(t('ms_btn_missions'), 'cc_missions'), design.textButton(t('ms_btn_home'), 'cc_home')]
    ])
  };
}

async function buildApprovals(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) {
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b(t('ms_btn_approvals'))}`,
        design.it(t('ms_body_appr_noctx')),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton(t('ms_btn_home'), 'cc_home')]
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
    : [design.it(t('ms_body_no_approvals'))];
  const rows = [];
  if (pending.length) {
    const apprRows = pending.map(a => [design.textButton(i18n.sprintf(t('ms_btn_approve'), a.id), `cc_appr:${a.id}:approve`), design.textButton(i18n.sprintf(t('ms_btn_reject'), a.id), `cc_appr:${a.id}:reject`)]);
    rows.push(...apprRows);
  }
  rows.push([design.textButton(t('ms_btn_missions'), 'cc_missions'), design.textButton(t('ms_btn_home'), 'cc_home')]);
  const text = design.compose([
    `${design.EMOJI.ai} ${design.b(t('ms_btn_approvals'))}`,
    design.it(t('ms_body_appr')),
    design.divider(),
    ...lines,
    design.divider()
  ]);
  return { text, keyboard: design.keyboard(rows) };
}

async function buildMissionGoalPrompt(userId) {
  const t = key => i18n.t(userId, key);
  return {
    text: design.compose([
      `${design.EMOJI.ai} ${design.b(t('ms_title_new'))}`,
      design.divider(),
      design.it(t('ms_body_goal')),
      design.it(t('ms_body_examples')),
      design.code(t('ms_ex1')),
      design.code(t('ms_ex2')),
      design.code(t('ms_ex3')),
      design.divider()
    ]),
    keyboard: design.keyboard([
      [design.textButton(t('ms_btn_cancel'), 'cc_missions')]
    ])
  };
}

async function buildMissionRunResult(userId, planId, extra) {
  const t = key => i18n.t(userId, key);
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
    `${design.EMOJI.ai} ${design.b(t('ms_title_launched'))}`,
    design.it(plan ? plan.title : t('ms_title_mission_bare')),
    design.divider(),
    ...stepLines,
    design.section(t('ms_sec_status')),
    design.row(t('ms_row_state'), design.badge(status === 'completed' ? 'success' : status === 'waiting_approval' ? 'warning' : 'info')),
    ...(status === 'waiting_approval' ? [design.it(t('ms_body_paused'))] : []),
    strategyBlock,
    design.divider()
  ];
  const rows = [];
  if (status === 'waiting_approval') rows.push([design.textButton(t('ms_btn_review'), 'cc_approvals')]);
  rows.push([design.textButton(t('ms_btn_missions'), 'cc_missions'), design.textButton(t('ms_btn_home'), 'cc_home')]);
  return { text: design.compose(lines), keyboard: design.keyboard(rows) };
}

async function launchMission1(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel(t('ms_err_no_workspace'), t('ms_err_provision_first')).text, keyboard: null };
  const adapter = getStoreAdapter();
  const progress = await learning.progress(adapter, ctx.workspace.id);
  if (!progress.complete && !isFounder(userId)) {
    botLearning.begin(userId);
    const res = await botLearning.buildPrompt(userId, adapter, ctx.workspace.id);
    return {
      text: design.compose([
        `${design.EMOJI.ai} ${design.b(t('ms_btn_m1'))}`,
        design.it(t('ms_body_m1_learn')),
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
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel(t('ms_err_no_workspace'), t('ms_err_provision_first')).text, keyboard: null };
  const adapter = getStoreAdapter();
  const progress = await learning.progress(adapter, ctx.workspace.id);
  if (!progress.complete && !isFounder(userId)) {
    return {
      text: design.compose([
        `${design.EMOJI.warning} ${design.b(t('ms_title_m2_locked'))}`,
        design.it(t('ms_body_m2_locked')),
        design.divider()
      ]),
      keyboard: design.keyboard([
        [design.textButton(t('ms_btn_continue'), 'cc_learn')],
        [design.textButton(t('ms_btn_home'), 'cc_home')]
      ])
    };
  }
  // Agent-facing prompt: model input, intentionally not localized.
  const result = await runtime.runGoal(adapter, ctx.workspace.id,
    'Run a full revenue pipeline for our target accounts: prospect, qualify, engage, propose and close deals for our known products.',
    { title: t('ms_title_pipeline'), priority: 'high', budgetCents: 1200 });
  audit.writeEntry('BOT_MISSION2_RUN', String(userId), 'success', { planId: result.plan.id, status: result.status });
  return buildMissionRunResult(userId, result.plan.id, result);
}

async function launchMarketMission(userId) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel(t('ms_err_no_workspace'), t('ms_err_provision_first')).text, keyboard: null };
  const adapter = getStoreAdapter();
  // Agent-facing prompt: model input, intentionally not localized.
  const result = await runtime.runGoal(adapter, ctx.workspace.id,
    'Analyze our target market: research the market, competitors, ideal customers and opportunity, then recommend where to focus.',
    { title: t('ms_title_market'), priority: 'high' });
  audit.writeEntry('BOT_MISSION_MARKET', String(userId), 'success', { planId: result.plan.id, status: result.status });
  return buildMissionRunResult(userId, result.plan.id, result);
}

async function launchGoalMission(userId, goal) {
  const t = key => i18n.t(userId, key);
  const ctx = await getCtx(userId);
  if (!ctx) return { text: design.errorPanel(t('ms_err_no_workspace'), t('ms_err_provision_first')).text, keyboard: null };
  const adapter = getStoreAdapter();
  const result = await runtime.runGoal(adapter, ctx.workspace.id, goal, { title: goal.slice(0, 120), priority: 'high' });
  audit.writeEntry('BOT_MISSION_GOAL', String(userId), 'success', { planId: result.plan.id, status: result.status });
  return buildMissionRunResult(userId, result.plan.id, result);
}

module.exports = {
  buildMissions,
  buildMissionDetail,
  buildMissionReport,
  buildMissionKPIs,
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
