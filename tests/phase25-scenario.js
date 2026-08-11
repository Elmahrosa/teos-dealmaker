// tests/phase25-scenario.js
// Phase 2.5 Stabilization — shared workflow scenario.
//
// Drives the REAL bot pipeline (handleMessage -> handlers -> services and
// menu.handleCallback -> screens) plus the refactored services directly, and
// asserts every step across the full product workflow:
//   onboarding UI -> learning UI (Mission 0) -> Mission Center -> missions ->
//   approvals -> pipeline -> dashboard -> memory -> intelligence ->
//   integrations -> provider switching -> queue -> workforce -> admin.
//
// The adapter is whatever bot/store.getStoreAdapter() resolves to, so the same
// scenario proves DRY (memory), LIVE (memory) and SUPABASE (Postgres) modes
// with zero changes. The caller sets process env and any mode before requiring.

'use strict';

const assert = require('assert');
const audit = require('../utils/auditLogger');
const { getStoreAdapter } = require('../bot/store');
const identity = require('../services/identity');
const { createRepos } = require('../db/repos');
const learning = require('../services/learning');
const memory = require('../services/memory');
const intelligence = require('../services/intelligence');
const integrations = require('../services/integrations');
const providers = require('../services/providers');
const queue = require('../services/queue');
const workforce = require('../services/workforce');
const runtime = require('../services/workforce/runtime');
const { handleMessage } = require('../bot/handlers');
const menu = require('../bot/menu');
const onboarding = require('../bot/onboarding');
const { getMode, setMode } = require('../config/mode');

const FOUNDER = 7700001;
const NEWCOMER = 8800001;

const strip = t => String(t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function makeBot() {
  const edits = [];
  const answers = [];
  return {
    edits,
    answers,
    async editMessageText(text, opts) { edits.push({ text, opts }); return { ok: true }; },
    async answerCallbackQuery(id, opts) { answers.push({ id, opts }); return { ok: true }; },
    async sendChatAction() { return { ok: true }; }
  };
}

function msg(userId, text) {
  return { chat: { id: userId }, from: { id: userId, first_name: 'P25' }, text };
}

async function runWorkflow({ mode, founderId = FOUNDER, newcomerId = NEWCOMER } = {}) {
  setMode(mode);
  assert.strictEqual(getMode(), mode, `mode starts as ${mode}`);

  const n = { count: 0 };
  const check = (cond, m) => { assert.ok(cond, m); n.count += 1; };
  const equal = (a, b, m) => { assert.strictEqual(a, b, m); n.count += 1; };

  audit.clearVault();
  const adapter = getStoreAdapter();
  check(Boolean(adapter), 'adapter resolved from bot/store');
  let repos;
  let sub;

  let qseq = 0;
  async function cb(action, userId) {
    const bot = makeBot();
    const query = {
      data: action,
      id: 'q' + (++qseq),
      from: { id: userId },
      message: { chat: { id: userId }, message_id: 1 }
    };
    if (onboarding.isActive(userId)) {
      const handled = await onboarding.handleCallback(query, bot);
      if (handled) {
        const last = bot.edits.length ? bot.edits[bot.edits.length - 1] : null;
        return { bot, last };
      }
    }
    await menu.handleCallback(query, bot);
    const last = bot.edits.length ? bot.edits[bot.edits.length - 1] : null;
    return { bot, last };
  }

  // ------------------------------------------------------------- onboarding
  function hasButton(screen, label) {
    const kb = screen && (screen.replyMarkup || (screen.opts && screen.opts.reply_markup));
    if (!kb || !kb.inline_keyboard) return false;
    return kb.inline_keyboard.some(row => row.some(b => String(b.text).includes(label)));
  }
  const onb = await handleMessage(msg(newcomerId, '/start'));
  check(/Set up your workspace/i.test(onb.text), 'newcomer /start kicks off workspace setup');
  const nameRes = await handleMessage(msg(newcomerId, 'Stabilize Ventures'));
  check(hasButton(nameRes, 'English') && hasButton(nameRes, 'العربية'), 'company name advances to language picker');
  const langRes = await cb('cc_onb_lang:en', newcomerId);
  check(hasButton(langRes.last, 'Growth'), 'language pick lands on plan screen');
  const planRes = await cb('cc_onb_plan:growth', newcomerId);
  check(hasButton(planRes.last, 'Start Mission 0'), 'plan selection completes onboarding');

  const ncUser = await identity.getUserByTelegram(adapter, newcomerId);
  check(Boolean(ncUser), 'newcomer user persisted');
  const ncWorkspace = await identity.getWorkspaceForUser(adapter, ncUser.id);
  check(Boolean(ncWorkspace), 'newcomer workspace provisioned');
  equal(ncWorkspace.plan, 'growth', 'onboarded plan is growth');
  equal(ncWorkspace.name, 'Stabilize Ventures', 'onboarded workspace name correct');
  // Activate subscription for newcomer growth plan
  repos = createRepos(adapter);
  sub = await repos.subscriptions.get(ncWorkspace.id);
  await repos.subscriptions.update(sub.id, { status: 'active' });

  // ----------------------------------------------------------- learning UI
  const founder = await identity.ensureUser(adapter, founderId, { display_name: 'Phase25 Founder' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: founder.id, companyName: 'Acme Stable', lang: 'en', plan: 'corporate'
  });
  check(Boolean(ws), 'founder workspace provisioned');
  // Activate subscription for founder corporate plan
  repos = createRepos(adapter);
  sub = await repos.subscriptions.get(ws.id);
  await repos.subscriptions.update(sub.id, { status: 'active' });

  await cb('cc_learn', newcomerId);
  for (let i = 0; i < learning.COMPANY_QUESTIONS.length; i++) {
    const r = await handleMessage(msg(newcomerId, 'company answer ' + i));
    check(r.text && !/Learning update failed|Cannot read/i.test(r.text), `learning company Q${i + 1} advances`);
  }
  const prodName = await handleMessage(msg(newcomerId, 'Enterprise SaaS'));
  check(!/Learning update failed/i.test(prodName.text), 'product name accepted');
  for (let i = 0; i < learning.PRODUCT_QUESTIONS.length; i++) {
    const r = await handleMessage(msg(newcomerId, 'product answer ' + i));
    check(r.text && !/Learning update failed/i.test(r.text), `learning product Q${i + 1} advances`);
  }
  await cb('cc_learn_done', newcomerId);
  for (let i = 0; i < learning.PLAYBOOK_QUESTIONS.length; i++) {
    const r = await handleMessage(msg(newcomerId, 'playbook answer ' + i));
    check(r.text && !/Learning update failed/i.test(r.text), `learning playbook Q${i + 1} advances`);
  }
  const personaName = await handleMessage(msg(newcomerId, 'CTO'));
  check(!/Learning update failed/i.test(personaName.text), 'persona name accepted');
  for (let i = 0; i < learning.PERSONA_QUESTIONS.length; i++) {
    const r = await handleMessage(msg(newcomerId, 'persona answer ' + i));
    check(r.text && !/Learning update failed/i.test(r.text), `learning persona Q${i + 1} advances`);
  }
  await cb('cc_learn_done', newcomerId);
  const ncProg = await learning.progress(adapter, ncWorkspace.id);
  equal(ncProg.complete, true, 'Mission 0 completes through the UI flow');

  for (const rec of [
    { section: 'company', key: 'company_name', value: 'Acme Corp' },
    { section: 'company', key: 'problem', value: 'Complex B2B deals' },
    { section: 'company', key: 'products', value: 'TEOS Dealmaker' },
    { section: 'company', key: 'ideal_customer', value: 'B2B SaaS founders' },
    { section: 'playbook', key: 'who_buys', value: 'CTOs' },
    { section: 'playbook', key: 'why_buy', value: 'Speed and accuracy' },
    { section: 'persona', key: 'goals', value: 'Grow ARR', context: 'CTO' },
    { section: 'persona', key: 'budget_authority', value: 'Yes', context: 'CTO' }
  ]) {
    await learning.record(adapter, ws.id, rec);
  }
  const prog = await learning.progress(adapter, ws.id);
  equal(prog.complete, true, 'founder learning foundation complete');

  // -------------------------------------------------------- Mission Center
  const missions = await cb('cc_missions', founderId);
  check(missions.last && /Mission Center/i.test(missions.last.text), 'Mission Center renders');
  const m1 = await cb('cc_mission1', founderId);
  check(m1.last && m1.last.text.length > 0 && !/Mission 1 failed/i.test(m1.last.text), 'Mission 1 launches without error');
  const m2 = await cb('cc_mission2', founderId);
  check(m2.last && m2.last.text.length > 0 && !/Mission failed/i.test(m2.last.text), 'Mission 2 launches without error');
  await cb('cc_mission_goal', founderId);
  const goalRes = await handleMessage(msg(founderId, 'Research our top competitors and explain how we win.'));
  check(goalRes.text && !/Mission failed/i.test(goalRes.text), 'custom mission goal runs');

  const missionList = await runtime.listMissions(adapter, ws.id);
  check(missionList.length >= 2, 'at least two missions recorded');
  const salesPlan = missionList.find(m => /Sell TEOS Dealmaker/i.test(m.title));
  check(Boolean(salesPlan), 'Mission 1 plan exists');
  check(['waiting_approval', 'running', 'planned', 'completed', 'budget_exceeded'].includes(salesPlan.status), 'Mission 1 reached a valid terminal/awaiting state');
  const detail = await cb(`cc_mission:${salesPlan.id}`, founderId);
  check(detail.last && /Mission #/.test(detail.last.text), 'mission detail renders');

  // ------------------------------------------------------------ approvals
  const approvals = await cb('cc_approvals', founderId);
  check(approvals.last && /Approvals/i.test(approvals.last.text), 'Approvals screen renders');
  const pending = await require('../db/repos').createRepos(adapter).approvals.list(ws.id, 'pending');
  if (pending.length) {
    const decided = await cb(`cc_appr:${pending[0].id}:approve`, founderId);
    check(decided.last && decided.last.text.length > 0, 'approval decision renders a screen');
  }
  const after = await require('../db/repos').createRepos(adapter).approvals.list(ws.id, 'pending');
  check(after.length < pending.length, 'approving removed a pending approval');

  // ------------------------------------------------------------- pipeline
  const pipeline = await cb('cc_pipeline', founderId);
  check(pipeline.last && /Sales Pipeline/i.test(pipeline.last.text), 'Pipeline screen renders');
  const pipeRun = await cb('cc_pipeline_run', founderId);
  check(pipeRun.last && pipeRun.last.text.length > 0 && !/Pipeline failed/i.test(pipeRun.last.text), 'pipeline run executes');
  const dealCount = (await require('../db/repos').createRepos(adapter).deals.list(ws.id)).length;
  check(dealCount > 0, 'pipeline run created deals');

  // ----------------------------------------------------------------- queue
  const qDeal = await queue.enqueueDeal(adapter, ws.id, 'Queue Inc');
  check(Boolean(qDeal && qDeal.id), 'queue enqueue creates a deal');
  const advanced = await queue.advanceQueue(adapter, ws.id, qDeal.id, 'research');
  check(Boolean(advanced), 'queue advance moves the deal');
  const snapshot = await queue.queueSnapshot(adapter, ws.id);
  check(Boolean(snapshot && snapshot.stages), 'queue snapshot has stages');
  const queueScreen = await cb('cc_queue', founderId);
  check(queueScreen.last && queueScreen.last.text.length > 0, 'queue screen renders');

  // ------------------------------------------------------------- dashboard
  const dash = await cb('cc_dashboard', founderId);
  check(dash.last && dash.last.text.length > 0, 'dashboard renders');
  const activity = await cb('cc_activity', founderId);
  check(activity.last && activity.last.text.length > 0, 'activity renders');
  const health = await cb('cc_health', founderId);
  check(health.last && /Platform Health/i.test(health.last.text), 'health screen renders');
  const healthRes = await workforce.healthCheck(adapter, ws.id);
  check(Boolean(healthRes), 'workforce healthCheck responds');

  // --------------------------------------------------------------- memory
  const memoryScreen = await cb('cc_memory', founderId);
  check(memoryScreen.last && /Business Knowledge/i.test(memoryScreen.last.text), 'memory screen renders');
  const edit = await cb('cc_mem_edit:company_name', founderId);
  check(edit.last && /Edit Company/i.test(edit.last.text), 'memory edit prompt renders');
  const memRes = await handleMessage(msg(founderId, 'Acme Stable Holdings'));
  check(Boolean(memRes.text), 'memory value accepted');
  const memValue = await memory.getMemory(adapter, ws.id);
  check(memValue.company_name === 'Acme Stable Holdings', 'memory edit persisted company_name');

  // ----------------------------------------------------------- intelligence
  const intel = await cb('cc_intelligence', founderId);
  check(intel.last && /Company Intelligence/i.test(intel.last.text), 'intelligence screen renders');
  await cb('cc_kg_add', founderId);
  const kgAdd = await cb('cc_kg_source:documents', founderId);
  check(kgAdd.last && /Add Knowledge/i.test(kgAdd.last.text), 'add-knowledge prompt renders');
  const kgRes = await handleMessage(msg(founderId, 'Deep Dive\nWe win deals with speed.'));
  check(Boolean(kgRes.text), 'knowledge document accepted');
  const docs = await intelligence.listDocuments(adapter, ws.id);
  check(docs.some(d => /Deep Dive/i.test(d.title)), 'knowledge document persisted');
  await cb('cc_kg_ask', founderId);
  const askRes = await handleMessage(msg(founderId, 'Who are our ideal customers?'));
  check(Boolean(askRes.text), 'knowledge ask returns an answer screen');

  // ---------------------------------------------------------- integrations
  const ints = await cb('cc_integrations', founderId);
  check(ints.last && /Enterprise Integration Hub/i.test(ints.last.text), 'integrations hub renders');
  const conn = await cb('cc_int_conn:slack', founderId);
  check(conn.last && /Slack/i.test(conn.last.text), 'connector detail renders');
  const enableRes = await cb('cc_int_enable:slack', founderId);
  check(Boolean(enableRes.last), 'connector enable renders a screen');
  const status = await integrations.manager.status(adapter, ws.id);
  const slackEnabled = status.categories.flatMap(c => c.connectors).some(x => x.id === 'slack' && x.enabled);
  equal(slackEnabled, true, 'slack connector enabled and persisted');
  const testRes = await integrations.manager.test(adapter, ws.id, 'slack');
  check(Boolean(testRes && testRes.ok), 'connector dry-run test passes');
  const syncRes = await cb('cc_sync_now', founderId);
  check(syncRes.last && syncRes.last.text.length > 0 && !/Sync failed/i.test(syncRes.last.text), 'integration sync runs');

  // ---------------------------------------------------- provider switching
  const provScreen = await cb('cc_providers', founderId);
  check(provScreen.last && /AI Providers/i.test(provScreen.last.text), 'providers screen renders');
  const picker = await cb('cc_pol:orchestrator', founderId);
  check(picker.last && /Provider for/i.test(picker.last.text), 'provider picker renders');
  const setRes = await cb('cc_pol_set:orchestrator:groq', founderId);
  check(Boolean(setRes.last), 'policy set renders a screen');
  const policy = await providers.getPolicy(adapter, ws.id);
  equal(policy.orchestrator && policy.orchestrator.provider, 'groq', 'policy switched orchestrator to groq');
  const gen = await providers.generate(adapter, ws.id, 'orchestrator', 'Test prompt for provider routing');
  equal(gen.provider, 'groq', 'generate follows the switched policy');
  check(gen.simulated === true, 'provider call is simulated (no live keys)');
  check(typeof gen.cost_cents === 'number', 'provider call records a cost');

  // ------------------------------------------------------------- workforce
  const wf = await cb('cc_workforce', founderId);
  check(wf.last && /My Revenue Team/i.test(wf.last.text), 'workforce screen renders');
  const agent = await cb('cc_agent:orchestrator', founderId);
  check(agent.last && agent.last.text.length > 0, 'agent detail renders');
  const run = await workforce.runAgent(adapter, ws.id, 'orchestrator', null, {
    prompt: 'Stabilization probe run'
  });
  equal(run.status, 'completed', 'runAgent completes');
  check(run.result && run.result.output && run.result.output.length > 0, 'runAgent produced output');
  const usage = await require('../db/repos').createRepos(adapter).usage.sum(ws.id);
  check(usage.cost_cents >= 0, 'usage ledger records provider usage');

  // ----------------------------------------------------------------- admin
  const admin = await cb('cc_admin', founderId);
  check(admin.last && /Admin/i.test(admin.last.text), 'admin screen renders');
  const auditScreen = await cb('cc_audit', founderId);
  check(auditScreen.last && auditScreen.last.text.length > 0, 'audit feed renders for admin');

  // ---------------------------------------------------------- mode switches
  if (mode === 'LIVE') {
    const live = await cb('cc_live', founderId);
    check(live.last && /Switch to LIVE/i.test(live.last.text), 'LIVE confirm panel renders');
    await cb('cc_live_confirm', founderId);
    equal(getMode(), 'LIVE', 'cc_live_confirm applies LIVE');
  }
  const dry = await cb('cc_dry', founderId);
  check(dry.last && /Switch to DRY/i.test(dry.last.text), 'DRY confirm panel renders');
  await cb('cc_dry_confirm', founderId);
  equal(getMode(), 'DRY', 'cc_dry_confirm applies DRY');

  // ------------------------------------------------------------- commands
  const COMMANDS = ['/status', '/mode', '/missions', '/pipeline', '/queue', '/memory', '/providers', '/integrations', '/workforce'];
  for (const cmd of COMMANDS) {
    const res = await handleMessage(msg(founderId, cmd));
    check(Boolean(res && res.chatId === founderId && typeof res.text === 'string' && res.text.length > 0),
      `command ${cmd} answers with a screen`);
  }

  return { checks: n.count, mode, missions: missionList.length };
}

module.exports = { runWorkflow, FOUNDER, NEWCOMER, strip };
