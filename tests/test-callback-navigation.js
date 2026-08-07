// Characterization regression test for bot/menu.js callback routing.
//
// This pins the pre-redesign behavior of the Telegram callback router so the
// modular rewrite (bot/screens/* + bot/menu.js) cannot silently change
// navigation, screen shape or permission gating. It does NOT assert on any
// feature that is out of scope for the redesign.
//
// Coverage:
//   1. Dispatch contract — every callback namespace lands on its screen.
//   2. Dead-button guard — every callback_data rendered on any screen is a
//      namespace the router actually dispatches.
//   3. Reachability — every user-visible button namespace appears on at least
//      one rendered keyboard (legacy/router-only namespaces are documented).
//   4. Live navigation — the Mission 1/2/Market/Goal launch flows, approval
//      loop, mission detail + pause/resume, connector detail and provider
//      pickers are driven end-to-end.
//   5. Guards — non-admins are denied audit/admin/mode actions.

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.TELEGRAM_ADMIN_IDS = '7700001';
process.env.TEOS_FOUNDER_TELEGRAM_ID = '7700001';

const assert = require('assert');
const audit = require('../utils/auditLogger');
const { getStoreAdapter } = require('../bot/store');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');
const learning = require('../services/learning');
const runtime = require('../services/workforce/runtime');
const workforce = require('../services/workforce');
const integrations = require('../services/integrations');
const menu = require('../bot/menu');

(async () => {
  let n = 0;
  const check = (cond, msg) => { assert.ok(cond, msg); n += 1; };
  const equal = (a, b, msg) => { assert.strictEqual(a, b, msg); n += 1; };

  audit.clearVault();
  const adapter = getStoreAdapter();
  const repos = createRepos(adapter);

  const FOUNDER = 7700001;
  const MEMBER = 7700002;
  const STRANGER = 7700003;

  // ------------------------------------------------------------------ setup
  const founder = await identity.ensureUser(adapter, FOUNDER, { display_name: 'Char Founder' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: founder.id,
    companyName: 'Acme Characterization',
    lang: 'en',
    plan: 'growth'
  });
  const wsId = ws.id;
  await identity.ensureUser(adapter, MEMBER, { display_name: 'Char Member' });
  await identity.addMember(adapter, { workspaceId: wsId, userId: (await identity.getUserByTelegram(adapter, MEMBER)).id, role: 'operator' });
  await identity.ensureUser(adapter, STRANGER, { display_name: 'Char Stranger' });

  // Complete the learning interview exactly like a fully onboarded founder so
  // every gated screen unlocks (Mission 1 requires complete company knowledge).
  await learning.record(adapter, wsId, { section: 'company', key: 'company_name', value: 'Acme Corp' });
  await learning.record(adapter, wsId, { section: 'company', key: 'problem', value: 'Complex B2B deals' });
  await learning.record(adapter, wsId, { section: 'company', key: 'products', value: 'Enterprise SaaS,API' });
  await learning.record(adapter, wsId, { section: 'company', key: 'ideal_customer', value: 'B2B SaaS founders' });
  await learning.record(adapter, wsId, { section: 'playbook', key: 'who_buys', value: 'CTOs and VPs of Sales' });
  await learning.record(adapter, wsId, { section: 'playbook', key: 'why_buy', value: 'Speed and accuracy' });
  await learning.record(adapter, wsId, { section: 'persona', key: 'goals', value: 'Grow ARR', context: 'CTO' });
  await learning.record(adapter, wsId, { section: 'persona', key: 'budget_authority', value: 'Yes', context: 'CTO' });
  const prog = await learning.progress(adapter, wsId);
  equal(prog.complete, true, 'learning foundation is complete for the founder workspace');

  // Seed a recorded deal + queue movement so the Deals and Timeline screens
  // render deal buttons before the dispatch contract walks them.
  await workforce.runPipeline(adapter, wsId);

  // ------------------------------------------------------------------ mocks
  let qid = 0;
  function makeBot() {
    const edits = [];
    const answers = [];
    const chatActions = [];
    return {
      edits,
      answers,
      chatActions,
      async editMessageText(text, opts) { edits.push({ text, opts }); },
      async answerCallbackQuery(id, opts) { answers.push({ id, opts }); },
      async sendChatAction(chatId, action) { chatActions.push({ chatId, action }); }
    };
  }
  function makeQuery(action, userId) {
    return {
      data: action,
      id: 'q' + (++qid),
      from: { id: userId },
      message: { chat: { id: userId }, message_id: 1 }
    };
  }
  async function drive(action, userId) {
    const bot = makeBot();
    await menu.handleCallback(makeQuery(action, userId), bot);
    return bot;
  }

  // ---------------------------------------------------------- router universe
  // Every exact callback_data namespace the router dispatches (case labels).
  const EXACT = new Set([
    'cc_home', 'btn_back', 'cc_dashboard', 'cc_workforce', 'cc_pipeline', 'cc_deals',
    'cc_pricing', 'cc_ai_guide', 'cc_settings', 'cc_learn', 'cc_learn_skip', 'cc_learn_done',
    'cc_learn_more', 'cc_learn_quit', 'cc_missions', 'cc_mission_goal', 'cc_mission1',
    'cc_mission2', 'cc_mission_market', 'cc_approvals', 'cc_memory', 'cc_mem_cancel',
    'cc_activity', 'cc_timeline', 'cc_costs', 'cc_health', 'cc_providers', 'cc_queue',
    'cc_briefing', 'cc_integrations', 'cc_int_all', 'cc_sync_now', 'cc_intelligence',
    'cc_kg_docs', 'cc_kg_cancel', 'cc_kg_ask', 'cc_kg_add', 'cc_audit', 'cc_admin',
    'cc_sales_run', 'cc_pipeline_run', 'cc_live', 'cc_live_confirm', 'cc_live_cancel',
    'cc_dry', 'cc_dry_confirm', 'cc_dry_cancel', 'cc_connect_crm', 'cc_mission_create',
    'cc_mission_form_cancel', 'cc_mission_dashboard', 'cc_fd_mode', 'cc_fd_approval', 'cc_fd_billing',
    'cc_fd_workspaces', 'cc_fd_customers', 'cc_fd_revenue', 'cc_fd_debug', 'cc_fd_ops',
    'cc_fd_sentinel', 'cc_fd_policy', 'cc_fd_analytics', 'cc_fd_flags', 'cc_fd_emergency',
    'cc_fd_emergency_stop', 'cc_fd_emergency_resume'
  ]);
  // Every prefix-namespace the router dispatches (startsWith branches).
  const PREFIX = [
    'cc_mem_edit:', 'cc_audit:', 'cc_agent:', 'cc_timeline_deal:', 'cc_pol:', 'cc_pol_set:',
    'cc_kg_source:', 'cc_kg_del:', 'cc_int_conn:', 'cc_int_enable:', 'cc_int_disable:',
    'cc_int_test:', 'cc_int_auth:', 'cc_set_lang:', 'cc_learn_persona:', 'cc_mission:',
    'cc_mission_pause:', 'cc_mission_resume:', 'cc_mission_run:', 'cc_appr:', 'cc_fd_approval_set:',
    'cc_fd_flags_set:'
  ];
  const isKnown = (cd) => EXACT.has(cd) || PREFIX.some(p => cd.startsWith(p));

  // ------------------------------------------------------------- assertions
  const seen = new Set();
  function lastEdit(bot, action) {
    check(bot.edits.length >= 1, '[' + action + '] expected an editMessageText');
    return bot.edits[bot.edits.length - 1];
  }
  function keyboardButtons(edit, action) {
    const kb = edit.opts && edit.opts.reply_markup;
    check(kb && Array.isArray(kb.inline_keyboard), '[' + action + '] screen carries an inline_keyboard');
    return kb.inline_keyboard.flat()
      .filter(b => b && typeof b.callback_data === 'string')
      .map(b => b.callback_data);
  }
  function register(bot, action, marker, msg) {
    const edit = lastEdit(bot, action);
    check(typeof edit.text === 'string' && edit.text.length > 0, '[' + action + '] edited text is non-empty');
    if (marker) check(edit.text.includes(marker), msg || '[' + action + '] text includes "' + marker + '"');
    check(!edit.text.includes('[object Object]'), '[' + action + '] no [object Object] leaked into text');
    for (const cd of keyboardButtons(edit, action)) {
      check(isKnown(cd), '[' + action + '] button "' + cd + '" is dispatched by router');
      seen.add(cd);
    }
    return edit;
  }
  async function driveAndExpect(action, userId, marker, msg) {
    const bot = await drive(action, userId);
    register(bot, action, marker, msg);
    return bot;
  }
  async function driveNoEdit(action, userId, answerHint) {
    const bot = await drive(action, userId);
    equal(bot.edits.length, 0, '[' + action + '] does not edit a message');
    check(bot.answers.length >= 1, '[' + action + '] answers the callback');
    if (answerHint) {
      check(bot.answers.some(a => String(a.opts && a.opts.text || '').includes(answerHint)),
        '[' + action + '] answers "' + answerHint + '"');
    }
    return bot;
  }

  // ------------------------------------------------------ 1. dispatch contract
  const contract = [
    ['cc_home', FOUNDER, 'Control Center'],
    ['btn_back', FOUNDER, 'Control Center'],
    ['cc_dashboard', FOUNDER, 'Dashboard'],
    ['cc_workforce', FOUNDER, 'My Revenue Team'],
    ['cc_pipeline', FOUNDER, 'Sales Pipeline'],
    ['cc_deals', FOUNDER, 'Deals'],
    ['cc_pricing', FOUNDER, 'Pricing'],
    ['cc_ai_guide', FOUNDER, 'AI Guide'],
    ['cc_settings', FOUNDER, 'Settings'],
    ['cc_missions', FOUNDER, 'Mission Center'],
    ['cc_mission_goal', FOUNDER, 'New Mission'],
    ['cc_mission_create', FOUNDER, 'Create Mission'],
    ['cc_mission_dashboard', FOUNDER, 'Mission Dashboard'],
    ['cc_approvals', FOUNDER, 'Approvals'],
    ['cc_memory', FOUNDER, 'Business Knowledge'],
    ['cc_activity', FOUNDER, "Today's Activity"],
    ['cc_timeline', FOUNDER, 'Deal Timeline'],
    ['cc_costs', FOUNDER, 'AI Cost Intelligence'],
    ['cc_health', FOUNDER, 'Platform Health'],
    ['cc_providers', FOUNDER, 'AI Providers'],
    ['cc_queue', FOUNDER, 'Progress'],
    ['cc_briefing', FOUNDER, 'Executive Briefing'],
    ['cc_integrations', FOUNDER, 'Enterprise Integration Hub'],
    ['cc_int_all', FOUNDER, 'All Connectors'],
    ['cc_intelligence', FOUNDER, 'Company Intelligence'],
    ['cc_kg_docs', FOUNDER, 'Intelligence Documents'],
    ['cc_kg_ask', FOUNDER, 'Ask Company Intelligence'],
    ['cc_audit', FOUNDER, 'Audit Log'],
    ['cc_admin', FOUNDER, 'Admin'],
    ['cc_sales_run', FOUNDER, 'Sales Flow'],
    ['cc_pipeline_run', FOUNDER, 'Pipeline Run'],
    ['cc_live', FOUNDER, 'Switch to LIVE mode?'],
    ['cc_live_cancel', FOUNDER, 'Admin'],
    ['cc_dry', FOUNDER, 'Switch to DRY mode?'],
    ['cc_dry_confirm', FOUNDER, 'Admin'],
    ['cc_dry_cancel', FOUNDER, 'Admin'],
    ['cc_fd_mode', FOUNDER, 'System Mode']
  ];
  for (const [action, userId, marker] of contract) {
    await driveAndExpect(action, userId, marker);
  }

  // ---------------------------------------------- 1b. founder consoles
  await driveAndExpect('cc_fd_policy', FOUNDER, 'Policy Engine', 'policy engine console renders');
  await driveAndExpect('cc_fd_analytics', FOUNDER, 'Analytics', 'analytics console renders');
  await driveAndExpect('cc_fd_flags', FOUNDER, 'Feature Flags', 'feature flags console renders');
  // Toggle a flag OFF then back ON so the on-disk state is restored.
  await driveAndExpect('cc_fd_flags_set:missions', FOUNDER, 'Feature Flags', 'flag toggle re-renders flags');
  await driveAndExpect('cc_fd_flags_set:missions', FOUNDER, 'Feature Flags', 'flag toggle restores the default');
  const flagsAfter = require('../config/flags');
  equal(flagsAfter.isEnabled('missions'), true, 'missions flag restored to enabled after toggle');
  await driveAndExpect('cc_fd_emergency', FOUNDER, 'Emergency Stop', 'emergency stop console renders');
  await driveAndExpect('cc_fd_emergency_stop', FOUNDER, 'ENGAGED', 'engaging the stop marks it engaged');
  const emergencyAfter = require('../config/emergency');
  equal(emergencyAfter.isEngaged(), true, 'emergency stop engaged while driven');
  await driveAndExpect('cc_fd_emergency_resume', FOUNDER, 'disengaged', 'resume marks the stop disengaged');
  equal(emergencyAfter.isEngaged(), false, 'emergency stop disengaged after resume');
  await driveAndExpect('cc_fd_sentinel', FOUNDER, 'Sentinel Shield', 'sentinel console renders');

  // ------------------------------------------------------------ 2. learn flow
  await driveAndExpect('cc_learn', FOUNDER, 'Question 1', 'learning interview starts on first question');
  await driveAndExpect('cc_learn_persona:CFO', FOUNDER, 'Question 1', 'persona picker keeps the interview in scope');
  await driveAndExpect('cc_learn_quit', FOUNDER, 'Control Center', 'quitting learning returns home');

  // ---------------------------------------------------- 3. live mission flows
  await driveAndExpect('cc_mission1', FOUNDER, 'Mission Launched', 'mission 1 launches a strategy plan');
  await driveAndExpect('cc_mission2', FOUNDER, 'Mission Launched', 'mission 2 launches a revenue pipeline plan');
  await driveAndExpect('cc_mission_market', FOUNDER, 'Mission Launched', 'market mission launches a research plan');
  // Now that plans exist, Mission Center renders one button per mission.
  await driveAndExpect('cc_missions', FOUNDER, 'Mission Center', 'mission center lists mission buttons');

  const missions = await runtime.listMissions(adapter, wsId);
  const sellMission = missions.find(m => m.title.includes('Sell TEOS Dealmaker'));
  check(sellMission, 'mission 1 plan persisted');
  equal(sellMission.status, 'waiting_approval', 'mission 1 halts for founder approval (present step gate)');
  const market = missions.find(m => m.title === 'Analyze a Market');
  check(market && market.id, 'market mission persisted');

  await driveAndExpect('cc_mission:' + market.id, FOUNDER, 'Mission #', 'mission detail renders');
  await driveAndExpect('cc_mission_pause:' + market.id, FOUNDER, 'Mission #', 'pause re-renders mission detail');
  await driveAndExpect('cc_mission_resume:' + market.id, FOUNDER, 'Mission Launched', 'resume renders mission result');

  // Pause/resume buttons render only while a plan is planned/running/paused;
  // drive a controlled stub plan so cc_mission_pause:/cc_mission_resume: are
  // reachable by real users.
  const stub = await repos.plans.create({
    workspace_id: wsId, title: 'Controlled stub', goal: 'noop',
    status: 'planned', priority: 'normal', metrics: {}, version: 'test'
  });
  await driveAndExpect('cc_mission:' + stub.id, FOUNDER, 'Mission #', 'stub plan detail renders a Pause button');
  await driveAndExpect('cc_mission_pause:' + stub.id, FOUNDER, 'Mission #', 'paused plan detail renders a Resume button');
  await driveAndExpect('cc_mission_resume:' + stub.id, FOUNDER, 'Mission Launched', 'resumed stub completes');

  // A fresh 'running' plan with zero completed steps renders the Start Mission
  // button (cc_mission_run:) used by the seeded founder mission.
  const runStub = await repos.plans.create({
    workspace_id: wsId, title: 'Running stub', goal: 'noop',
    status: 'running', priority: 'normal', metrics: {}, version: 'test'
  });
  await repos.planSteps.create({
    workspace_id: wsId, plan_id: runStub.id, step_key: 'assess',
    agent_type: 'revenue_strategist', task: 'assess'
  });
  await driveAndExpect('cc_mission:' + runStub.id, FOUNDER, 'Mission #', 'running stub plan detail renders a Start Mission button');
  const runCd = [...seen].find(cd => cd.startsWith('cc_mission_run:'));
  check(Boolean(runCd), 'running plan detail offers a cc_mission_run button');

  // ------------------------------------------------- 4. approval loop + gates
  const proposal = await runtime.runGoal(adapter, wsId,
    'Prepare and send a proposal to Acme Corp', { title: 'Acme proposal' });
  equal(proposal.status, 'waiting_approval', 'proposal goal halts for approval');

  // Approve every pending request through the callback loop until none remain
  // (mission 1 present-gate + the seeded proposal plan).
  for (let i = 0; i < 10; i++) {
    const bot = await drive('cc_approvals', FOUNDER);
    const edit = register(bot, 'cc_approvals', 'Approvals');
    const approve = keyboardButtons(edit, 'cc_approvals')
      .find(cd => cd.startsWith('cc_appr:') && cd.endsWith(':approve'));
    if (!approve) break;
    await driveAndExpect(approve, FOUNDER, 'Approvals', 'approval decision re-renders approvals');
  }
  await driveAndExpect('cc_approvals', FOUNDER, 'No pending approvals.', 'all approvals settled');

  // --------------------------------------- 5. dynamic prefix namespaces
  // Provider policy picker + provider switch.
  const polAgent = [...seen].find(cd => cd.startsWith('cc_pol:')) || 'cc_pol:strategist';
  await driveAndExpect(polAgent, FOUNDER, 'Provider for', 'provider picker renders');
  const polSet = [...seen].find(cd => cd.startsWith('cc_pol_set:') && cd.split(':').length === 3);
  check(Boolean(polSet), 'provider picker offers a cc_pol_set button');
  await driveAndExpect(polSet, FOUNDER, 'AI Providers', 'setting a provider policy returns to providers');

  // Connector detail + enable/test actions.
  const connCd = [...seen].find(cd => cd.startsWith('cc_int_conn:'));
  check(Boolean(connCd), 'all-connectors screen offers a cc_int_conn button');
  await driveAndExpect(connCd, FOUNDER, 'connector', 'connector detail renders');
  const enableCd = [...seen].find(cd => cd.startsWith('cc_int_enable:'));
  const disableCd = [...seen].find(cd => cd.startsWith('cc_int_disable:'));
  const testCd = [...seen].find(cd => cd.startsWith('cc_int_test:'));
  const authCd = [...seen].find(cd => cd.startsWith('cc_int_auth:'));
  if (enableCd) await driveAndExpect(enableCd, FOUNDER, 'connector', 'enable re-renders connector detail');
  if (disableCd) await driveAndExpect(disableCd, FOUNDER, 'connector', 'disable re-renders connector detail');
  if (testCd) await driveNoEdit(testCd, FOUNDER);
  if (authCd) await driveNoEdit(authCd, FOUNDER);

  // An OAuth connector renders the cc_int_auth: connect button.
  const oauthConn = Object.entries(integrations.catalog.CONNECTORS).find(([, c]) => c.auth === 'oauth');
  if (oauthConn) {
    await driveAndExpect('cc_int_conn:' + oauthConn[0], FOUNDER, 'connector', 'oauth connector detail renders');
    const oauthAuthCd = [...seen].find(cd => cd.startsWith('cc_int_auth:'));
    if (oauthAuthCd) await driveNoEdit(oauthAuthCd, FOUNDER);
  }

  // Knowledge source chooser + document delete.
  await driveAndExpect('cc_kg_add', FOUNDER, 'Add Knowledge', 'knowledge source chooser renders');
  await driveAndExpect('cc_kg_source:products', FOUNDER, 'Add Knowledge ·', 'knowledge source type renders');
  const delCd = [...seen].find(cd => cd.startsWith('cc_kg_del:'));
  check(Boolean(delCd), 'documents screen offers a cc_kg_del button');
  await driveAndExpect(delCd, FOUNDER, 'Intelligence Documents', 'deleting a document re-renders documents');
  await driveAndExpect('cc_kg_cancel', FOUNDER, 'Company Intelligence', 'cancel returns to intelligence hub');

  // Timeline per deal.
  const dealCd = [...seen].find(cd => cd.startsWith('cc_timeline_deal:'));
  check(Boolean(dealCd), 'timeline screen offers a cc_timeline_deal button');
  await driveAndExpect(dealCd, FOUNDER, 'Deal Timeline', 'deal timeline renders');

  // Memory editor + lang + agent detail + audit paging + sync.
  await driveAndExpect('cc_mem_edit:company_name', FOUNDER, 'Edit Company_name', 'memory edit renders');
  await driveAndExpect('cc_mem_cancel', FOUNDER, 'Business Knowledge', 'memory cancel returns to knowledge');
  await driveAndExpect('cc_set_lang:en', FOUNDER, 'Settings', 'language switch re-renders settings');
  await driveAndExpect('cc_agent:strategist', FOUNDER, 'Strategist', 'agent detail renders');
  await driveAndExpect('cc_audit:0', FOUNDER, 'Audit Log', 'audit page renders');
  await driveAndExpect('cc_sync_now', FOUNDER, 'Integration Sync', 'sync re-renders the sync result');

  // --------------------------------------- 6. permission guards (non-admin)
  const guards = ['cc_learn', 'cc_learn_skip', 'cc_learn_done', 'cc_learn_more',
    'cc_audit', 'cc_audit:0', 'cc_live', 'cc_live_confirm', 'cc_dry', 'cc_dry_confirm'];
  for (const action of guards) {
    await driveAndExpect(action, STRANGER, 'Access denied', 'stranger is denied ' + action);
  }

  // --------------------------------------------------- 7. no-edit / legacy
  // The cc_upload_catalog / cc_launch_campaign "Coming soon" stubs were removed
  // with the legacy dashboard; they now fall through to the unknown-action
  // handler (and are no longer dispatched namespaces).
  await driveNoEdit('cc_upload_catalog', FOUNDER, 'Unknown action');
  await driveNoEdit('cc_launch_campaign', FOUNDER, 'Unknown action');
  await driveNoEdit('cc_set_lang:fr', FOUNDER, 'Unknown language');
  await driveNoEdit('cc_totally_unknown_xyz', FOUNDER, 'Unknown action');

  // -------------------------------------------- 8. role-aware home keyboards
  const memberHome = await drive('cc_home', MEMBER);
  const memberEdit = register(memberHome, 'cc_home', 'MISSION CONTROL', 'operator sees mission control');
  const memberButtons = keyboardButtons(memberEdit, 'cc_home');
  check(!memberButtons.includes('cc_admin'), 'operator home omits cc_admin');
  check(!memberButtons.includes('cc_audit'), 'operator home omits cc_audit');
  check(memberButtons.includes('cc_intelligence'), 'operator home keeps company intelligence');

  const strangerHome = await drive('cc_home', STRANGER);
  register(strangerHome, 'cc_home', 'TEOS DEALMAKER', 'stranger sees onboarding hero');

  // Onboarding-stage workspace: buildHome renders the learn launcher whose
  // keyboard carries cc_learn and cc_mission_market (unlocked only when the
  // learning interview is incomplete).
  const NEWBIE = 7700004;
  const newbie = await identity.ensureUser(adapter, NEWBIE, { display_name: 'Char Newbie' });
  await identity.onboardWorkspace(adapter, { ownerUserId: newbie.id, companyName: 'Fresh Acme', lang: 'en', plan: 'growth' });
  const newbieHome = await drive('cc_home', NEWBIE);
  register(newbieHome, 'cc_home', 'Welcome', 'incomplete onboarding renders the learn launcher');

  // ------------------------------------------------------------ 9. coverage
  const RENDERED_REQUIRED_EXACT = [
    'cc_home', 'cc_dashboard', 'cc_workforce', 'cc_pipeline', 'cc_deals', 'cc_pricing',
    'cc_settings', 'cc_learn', 'cc_learn_quit', 'cc_missions', 'cc_mission_goal',
    'cc_mission_create', 'cc_mission_dashboard', 'cc_mission1', 'cc_mission2', 'cc_mission_market', 'cc_approvals', 'cc_memory',
    'cc_mem_cancel', 'cc_activity', 'cc_timeline', 'cc_costs', 'cc_health', 'cc_providers',
    'cc_queue', 'cc_briefing', 'cc_integrations', 'cc_int_all', 'cc_sync_now',
    'cc_intelligence', 'cc_kg_docs', 'cc_kg_cancel', 'cc_kg_ask', 'cc_kg_add',
    'cc_audit', 'cc_sales_run', 'cc_pipeline_run',
    'cc_live', 'cc_live_confirm', 'cc_live_cancel', 'cc_dry', 'cc_dry_confirm', 'cc_dry_cancel'
  ];
  const RENDERED_REQUIRED_PREFIX = [
    'cc_set_lang:', 'cc_mem_edit:', 'cc_kg_source:', 'cc_kg_del:', 'cc_int_conn:',
    'cc_int_enable:', 'cc_int_disable:', 'cc_int_test:', 'cc_int_auth:', 'cc_pol:',
    'cc_pol_set:', 'cc_timeline_deal:', 'cc_mission:', 'cc_mission_run:', 'cc_appr:',
    'cc_mission_pause:', 'cc_mission_resume:'
  ];
  const missing = RENDERED_REQUIRED_EXACT.filter(cd => !seen.has(cd));
  const missingPrefix = RENDERED_REQUIRED_PREFIX.filter(p => ![...seen].some(cd => cd.startsWith(p)));
  equal(missing.length, 0, 'every user-visible exact namespace is rendered at least once (missing: ' + missing.join(',') + ')');
  equal(missingPrefix.length, 0, 'every user-visible prefix namespace is rendered at least once (missing: ' + missingPrefix.join(',') + ')');

  // Documented router-only / legacy namespaces: dispatched above or by design
  // without a rendering button (cc_ai_guide, cc_learn_skip, cc_learn_more,
  // cc_learn_done, cc_learn_persona:, cc_agent:, cc_audit:, cc_connect_crm,
  // cc_mission_form_cancel, btn_back, cc_mem_edit:).
  // cc_admin is reachable via the /admin command; the founder consoles
  // (cc_fd_*) are driven in the dispatch contract and section 1b; neither renders itself.

  const { getMode } = require('../config/mode');
  equal(getMode(), 'DRY', 'test never flips global mode to LIVE');

  console.log('\n✓ callback navigation characterization (' + n + ' assertions passed)');
  console.log('  dispatch · dead-button guard · reachability · mission flows · approvals · guards');
})().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
