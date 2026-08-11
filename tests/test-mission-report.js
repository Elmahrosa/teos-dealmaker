const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');
const runtime = require('../services/workforce/runtime');
const { missionReport, executiveReportText } = require('../services/missionReport');
const render = require('../server/render');
const founderSeed = require('../services/founderSeed');

(async () => {
  const adapter = createMemoryAdapter();

  await identity.ensureUser(adapter, 8801, { display_name: 'Report Founder' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, 8801)).id,
    companyName: 'Report Co',
    lang: 'en',
    plan: 'growth'
  });
  // Activate subscription for growth plan (simulate webhook)
  const repos = createRepos(adapter);
  const sub = await repos.subscriptions.get(ws.id);
  await repos.subscriptions.update(sub.id, { status: 'active' });

  const outcome = await runtime.runGoal(adapter, ws.id, 'Research Acme Corp and build a company profile', { title: 'Acme research' });
  equal(outcome.status, 'completed', 'research mission completes');

  const report = await missionReport(adapter, ws.id, outcome.plan.id);
  equal(report.plan.id, outcome.plan.id, 'report references the mission');
  equal(report.plan.title, 'Acme research', 'report carries mission title');
  equal(report.kpis.total_steps, outcome.steps.length, 'KPI total steps match plan');
  equal(report.kpis.completed_steps, report.kpis.total_steps, 'all steps completed in report');
  equal(report.kpis.completion_rate, 100, 'completion rate 100%');
  equal(report.kpis.success_rate, 100, 'success rate 100%');
  assert.strictEqual(report.kpis.failed_steps, 0, 'no failed steps');
  assert.strictEqual(report.kpis.skipped_steps, 0, 'no skipped steps');
  assert.strictEqual(report.kpis.awaiting_approval, 0, 'no pending approvals');
  check(typeof report.kpis.avg_confidence === 'number', 'KPI avg confidence is a real reviewed value');
  check(typeof report.kpis.total_cost_cents === 'number', 'KPI total cost is a number');
  check(report.kpis.agents_used > 0, 'agents used counted');
  check(report.timeline.length === report.kpis.total_steps, 'timeline has one row per step');
  check(report.timeline.every(s => s.agent_type), 'timeline rows carry agent type');
  check(report.agents.length === report.kpis.agents_used, 'workforce utilization per agent');
  check(report.providers.length >= 1, 'provider usage recorded');

  // Timeline is ordered chronologically by completion time.
  const stamps = report.timeline.map(s => String(s.completed_at || s.started_at || ''));
  equal(stamps.slice().sort().join('|'), stamps.join('|'), 'timeline sorted by completion time');

  // Executive report text is present and well-formed.
  const text = await executiveReportText(adapter, ws.id, outcome.plan.id);
  check(text.includes('EXECUTIVE MISSION REPORT'), 'executive report header');
  check(text.includes('Key Performance Indicators'), 'executive report has KPIs section');
  check(text.includes('Timeline'), 'executive report has timeline section');

  // Web render of the executive mission report.
  const html = render.renderMissionReport(report);
  check(html.includes('EXECUTIVE MISSION REPORT'), 'web report renders header');
  check(html.includes('EXECUTIVE MISSION TIMELINE'), 'web report renders timeline');
  check(html.includes('MISSION KPIs'), 'web report renders KPIs');
  check(html.includes('WORKFORCE UTILIZATION'), 'web report renders workforce');

  // report resolves the workspace from the plan row alone (no workspace arg).
  const reportByPlan = await missionReport(adapter, null, outcome.plan.id);
  equal(reportByPlan.plan.id, outcome.plan.id, 'report resolves workspace from plan');
  equal(reportByPlan.kpis.completed_steps, report.kpis.completed_steps, 'workspace-resolved report identical');
  equal(await missionReport(adapter, null, 99999999), null, 'missing plan returns null');

  // Customer #0 render proves the reference story.
  process.env.TEOS_FOUNDER_TELEGRAM_ID = '8801';
  const seeded = await founderSeed.ensureFounderWorkspace(adapter);
  equal(seeded.seeded, true, 'founder workspace seeded');
  const cz = await founderSeed.ensureFounderMission(adapter, seeded.workspace.id);
  const czReport = await missionReport(adapter, seeded.workspace.id, cz.plan.id);
  const czHtml = render.renderCustomerZero(czReport);
  check(czHtml.includes('CUSTOMER #0'), 'customer-0 page renders header');
  check(czHtml.includes('ELMAHROSA INTERNATIONAL'), 'customer-0 page names the reference customer');
  check(czHtml.includes('/report/' + cz.plan.id), 'customer-0 page links to the executive report');
  check(!czHtml.includes('Pipeline value'), 'customer-0 page hides empty pipeline value stat');

  // Revenue identified stat is hidden when no real figure exists.
  check(!html.includes('Revenue identified') || report.kpis.revenue_cents !== null, 'report hides empty revenue stat');

  // Stale [simulated X] prefixes in stored step outputs are stripped on render.
  const { forWorkspace } = require('../db/repos');
  const fw = forWorkspace(adapter, outcome.plan.workspace_id || ws.id);
  const staleStep = report.timeline[0];
  await fw.planSteps.update(staleStep.id, {
    output: '[simulated Claude · claude-sonnet-4-5] | Analysis: A research report about Acme Corp with market context.'
  });
  const sanitized = await missionReport(adapter, ws.id, outcome.plan.id);
  const row = sanitized.timeline.find(s => s.id === staleStep.id);
  check(!String(row.output).includes('[simulated'), 'simulated prefix stripped from timeline output');
  check(String(row.output).includes('Analysis: A research report'), 'sanitized output retains real content');
  check(!render.renderMissionReport(sanitized).includes('simulated Claude'), 'web report shows no simulated branding');

  console.log(`\n✓ mission report service + executive web render (${n} assertions passed)`);
  process.exit(0);
})().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});

let n = 0;
function check(cond, msg) { assert.ok(cond, msg); n += 1; }
function equal(a, b, msg) { assert.strictEqual(a, b, msg); n += 1; }
