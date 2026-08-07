// Founder self-hosting regression test.
//
// Covers the founder bootstrap contract:
//   1. Startup seed — founder user, workspace_founder ("Elmahrosa International")
//      on the internal FOUNDER plan, super_admin membership, lifetime internal
//      subscription, Customer #0 and the running 13-step first mission.
//   2. Idempotency — re-running the seed never duplicates rows.
//   3. Context resolution — the founder resolves a workspace context and the
//      subscription shows as internal (no billing).
//   4. Create Mission form — the 8-step founder-only flow drives
//      handleMessage() end-to-end and persists structured fields.
//   5. Mission Dashboard — renders for the founder; denied for non-founders;
//      the Mission Center offers dashboard/create for the founder.

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.TELEGRAM_ADMIN_IDS = '8800001';
process.env.TEOS_FOUNDER_TELEGRAM_ID = '8800001';
process.env.DATABASE_URL = process.env.DATABASE_URL || '';

const assert = require('assert');
const audit = require('../utils/auditLogger');
const { getStoreAdapter } = require('../bot/store');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');
const founderSeed = require('../services/founderSeed');
const { getWorkspaceContext } = require('../services/workspace');
const { handleMessage } = require('../bot/handlers');
const menu = require('../bot/menu');
const missionState = require('../bot/missionState');

(async () => {
  let n = 0;
  const check = (cond, msg) => { assert.ok(cond, msg); n += 1; };
  const equal = (a, b, msg) => { assert.strictEqual(a, b, msg); n += 1; };

  audit.clearVault();
  const adapter = getStoreAdapter();
  const repos = createRepos(adapter);

  const FOUNDER = 8800001;
  const STRANGER = 8800002;

  // ------------------------------------------------ 1. startup seed
  const seed = await founderSeed.bootstrapFounder(adapter);
  equal(seed.seeded, true, 'founder bootstrap seeded');
  check(seed.workspace && seed.workspace.slug === 'workspace_founder', 'seed created the workspace_founder workspace');
  equal(seed.workspace.name, 'Elmahrosa International', 'founder workspace name is Elmahrosa International');
  equal(seed.workspace.plan, 'founder', 'founder workspace is on the internal FOUNDER plan');
  equal(seed.workspace.status, 'active', 'founder workspace is active');

  const founderUser = await identity.getUserByTelegram(adapter, FOUNDER);
  check(Boolean(founderUser), 'founder user created');
  equal(seed.workspace.owner_user_id, founderUser.id, 'founder owns the workspace');

  const member = await repos.members.get(seed.workspace.id, founderUser.id);
  equal(member.role, 'super_admin', 'founder member role is super_admin');

  const sub = await repos.subscriptions.get(seed.workspace.id);
  equal(sub.plan, 'founder', 'subscription plan is founder');
  equal(sub.status, 'active', 'subscription status is active');
  equal(sub.cycle, 'lifetime', 'subscription is lifetime');
  equal(sub.provider, 'internal', 'subscription provider is internal');

  const deals = await repos.deals.list(seed.workspace.id, {});
  equal(deals.length, 1, 'exactly one customer deal');
  const c0 = deals[0];
  equal(c0.company_name, 'Elmahrosa International', 'customer #0 is Elmahrosa International');
  equal(c0.stage, 'active', 'customer #0 stage is active');
  equal(c0.status, 'active', 'customer #0 status is active');
  const notes = await repos.dealNotes.list(seed.workspace.id, c0.id);
  check(notes.some(x => x.note.includes('AI Security')), 'customer #0 deal note records the industry');
  check(notes.some(x => x.note.includes('https://dealmaker.elmahrosa.org')), 'customer #0 deal note records the website');

  const seededPlans = await repos.plans.list(seed.workspace.id);
  equal(seededPlans.length, 1, 'exactly one mission seeded');
  const mission = seededPlans[0];
  equal(mission.title, 'Sell TEOS DealMaker', 'first mission title');
  equal(mission.status, 'running', 'first mission status is running');
  equal(mission.priority, 'high', 'first mission priority is high');
  check(mission.metrics && mission.metrics.budget_cents === 800, 'first mission has an 800 cent budget');
  check(mission.metrics && mission.metrics.duration_hours === 24, 'first mission deadline is 24 hours');
  const steps = await repos.planSteps.list(seed.workspace.id, mission.id);
  equal(steps.length, 13, 'first mission has the full 13-step revenue workflow');
  const stepKeys = steps.map(s => s.step_key);
  for (const k of ['assess', 'research', 'icp', 'prospects', 'qualify', 'outreach_email', 'outreach_linkedin', 'proposal', 'meetings', 'pricing', 'followups', 'forecast', 'present']) {
    check(stepKeys.includes(k), 'workflow includes step ' + k);
  }
  const gate = steps.find(s => s.step_key === 'present');
  check(RegExp('Requires founder approval', 'i').test(gate.task), 'final step requires founder approval');

  // ------------------------------------------------ 2. idempotency
  const again = await founderSeed.bootstrapFounder(adapter);
  equal(again.seeded, true, 're-run still seeds');
  check((await repos.workspaces.list()).filter(w => w.slug === 'workspace_founder').length === 1, 'workspace not duplicated');
  check((await repos.deals.list(seed.workspace.id, {})).length === 1, 'customer #0 not duplicated');
  check((await repos.plans.list(seed.workspace.id)).length === 1, 'first mission not duplicated');

  // ------------------------------------------------ 3. context resolution
  const ctx = await getWorkspaceContext(adapter, FOUNDER);
  check(Boolean(ctx), 'founder resolves a workspace context');
  equal(ctx.workspace.name, 'Elmahrosa International', 'founder context workspace name');
  equal(ctx.isFounder, true, 'founder context is founder');
  equal(ctx.subscriptionLabel, 'Control', 'founder subscription shows Control (no billing)');
  equal(ctx.deals.total, 1, 'founder context shows 1 deal');
  equal(ctx.role, 'super_admin', 'founder context role is super_admin');

  // ------------------------------------------------ 4. create-mission form
  missionState.begin(FOUNDER, { mode: 'mission_create', step: 'name', mission: {} });
  const msg = (text) => ({ chat: { id: FOUNDER }, from: { id: FOUNDER }, text });
  let res = await handleMessage(msg('Sell Civic Mixer'));
  check(res.text.includes('2 of 8'), 'step 1 name advances to step 2 (goal)');
  res = await handleMessage(msg('Sell the Civic Mixer gateway to AI teams'));
  check(res.text.includes('3 of 8'), 'step 2 goal advances to step 3 (customer)');
  res = await handleMessage(msg('Civic Labs'));
  check(res.text.includes('4 of 8'), 'step 3 customer advances to step 4 (market)');
  res = await handleMessage(msg('AI infrastructure'));
  check(res.text.includes('5 of 8'), 'step 4 market advances to step 5 (priority)');
  res = await handleMessage(msg('urgent-ish'));
  check(res.text.includes('Priority must be'), 'invalid priority is rejected');
  res = await handleMessage(msg('urgent'));
  check(res.text.includes('6 of 8'), 'step 5 priority advances to step 6 (revenue)');
  res = await handleMessage(msg('$75,000'));
  check(res.text.includes('7 of 8'), 'step 6 revenue advances to step 7 (deadline)');
  res = await handleMessage(msg('48 hours'));
  check(res.text.includes('8 of 8'), 'step 7 deadline advances to step 8 (notes)');
  res = await handleMessage(msg('Run the full workflow.'));
  check(res.text.includes('Mission Launched'), 'final step launches the mission');
  check(res.replyMarkup && Array.isArray(res.replyMarkup.inline_keyboard), 'mission result carries a keyboard');
  equal(missionState.pending(FOUNDER), false, 'mission state cleared after launch');

  const allPlans = await repos.plans.list(seed.workspace.id);
  const custom = allPlans.find(p => p.title === 'Sell Civic Mixer');
  check(Boolean(custom), 'custom mission persisted with its title');
  const storedMission = custom && custom.metrics && custom.metrics.mission;
  check(Boolean(storedMission), 'custom mission structured fields saved to metrics');
  if (storedMission) {
    equal(storedMission.target_customer, 'Civic Labs', 'target customer saved');
    equal(storedMission.target_market, 'AI infrastructure', 'target market saved');
    equal(storedMission.priority, 'urgent', 'priority saved');
    equal(storedMission.expected_revenue, '$75,000', 'expected revenue saved');
    equal(storedMission.deadline, '48 hours', 'deadline saved');
    equal(storedMission.notes, 'Run the full workflow.', 'notes saved');
  }

  // ------------------------------------------------ 5. dashboard render
  const qid = { n: 0 };
  const makeBot = () => ({
    edits: [],
    answers: [],
    async editMessageText(t, o) { this.edits.push({ text: t, opts: o }); },
    async answerCallbackQuery() {},
    async sendChatAction() {}
  });
  const makeQuery = (action, userId) => ({
    data: action,
    id: 'q' + (++qid.n),
    from: { id: userId },
    message: { chat: { id: userId }, message_id: 1 }
  });

  const bot = makeBot();
  await menu.handleCallback(makeQuery('cc_mission_dashboard', FOUNDER), bot);
  check(bot.edits.length >= 1, 'dashboard edits a message');
  const edit = bot.edits[bot.edits.length - 1];
  check(edit.text.includes('Mission Dashboard'), 'dashboard header renders');
  check(edit.text.includes('MISSIONS'), 'dashboard shows missions section');
  check(edit.text.includes('Leads found'), 'dashboard shows the revenue workflow metrics');
  check(edit.text.includes('Revenue forecast'), 'dashboard shows revenue forecast');

  const mc = makeBot();
  await menu.handleCallback(makeQuery('cc_missions', FOUNDER), mc);
  const mcEdit = mc.edits[mc.edits.length - 1];
  const buttons = mcEdit.opts.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
  check(buttons.includes('cc_mission_dashboard'), 'mission center offers the dashboard for founder');
  check(buttons.includes('cc_mission_create'), 'mission center offers create mission for founder');

  await identity.ensureUser(adapter, STRANGER, { display_name: 'Stranger' });
  const sb = makeBot();
  await menu.handleCallback(makeQuery('cc_mission_dashboard', STRANGER), sb);
  const sEdit = sb.edits[sb.edits.length - 1];
  check(sEdit.text.includes('Access denied'), 'stranger is denied the founder dashboard');

  console.log('\n✓ founder self-hosting (' + n + ' assertions passed)');
  console.log('  seed · idempotency · context · create-mission form · dashboard');
})().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
