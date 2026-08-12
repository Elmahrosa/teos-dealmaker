// v1.1 Conversation Router test suite (Phase 14).
// Covers: router pipeline (no /start fallback), intent detection EN+AR,
// founder bypass (never sees billing), native Arabic replies, memory
// continuity, Customer #0 bootstrap, natural-language mission creation,
// customer-mode gating, and smart error recovery.

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.TELEGRAM_ADMIN_IDS = '8800001';
process.env.TEOS_FOUNDER_TELEGRAM_ID = '8800001';
process.env.DATABASE_URL = process.env.DATABASE_URL || '';

const assert = require('assert');
const { getStoreAdapter } = require('../bot/store');
const founderSeed = require('../services/founderSeed');
const router = require('../services/router');
const intent = require('../services/router/intent');
const memory = require('../services/router/memory');
const executor = require('../services/router/executor');
const founderMission = require('../services/founderMission');
const identity = require('../services/identity');
const { createRepos } = require('../db/repos');

(async () => {
  let n = 0;
  const check = (cond, msg) => { assert.ok(cond, msg); n += 1; };
  const equal = (a, b, msg) => { assert.strictEqual(a, b, msg); n += 1; };

  const adapter = getStoreAdapter();
  const FOUNDER = 8800001;
  const CUSTOMER = 8800002;

  // ---------------------------------------------------- Customer #0 bootstrap
  memory.reset();
  const seed = await founderSeed.bootstrapFounder(adapter);
  equal(seed.seeded, true, 'founder bootstrap seeded');
  check(seed.workspace && seed.workspace.slug === 'workspace_founder', 'workspace_founder exists');
  const wsId = seed.workspace.id;
  const repos = createRepos(adapter);
  const plans = await repos.plans.list(wsId);
  check(plans.some(p => p.title === 'Sell TEOS DealMaker'), 'Sell TEOS DealMaker mission provisioned for Customer #0');

  // ------------------------------------ Auto-start guard (Phase 9/10)
  const missionPlan = plans.find(p => p.title === 'Sell TEOS DealMaker');
  await repos.plans.update(wsId, missionPlan.id, { status: 'completed' });
  const notStarted = await founderMission.autoStartFounderMission(adapter, wsId);
  equal(notStarted.started, false, 'auto-start skips an already-executed mission');
  await repos.plans.update(wsId, missionPlan.id, { status: 'running' });

  // ----- P1: founder approval gate — Customer #0 mission pauses at 'present'
  const missionRun = await founderMission.autoStartFounderMission(adapter, wsId);
  equal(missionRun.started, true, 'auto-start runs the running Customer #0 mission');
  equal(missionRun.status, 'waiting_approval', 'mission halts at the founder approval gate');
  equal(missionRun.pendingApprovals, 1, 'exactly one approval request is pending');

  // ------------------------------------------ Intent detection EN + AR
  const cases = {
    'hi': 'greeting',
    'hello': 'greeting',
    'السلام عليكم': 'greeting',
    'مرحبا': 'greeting',
    'create mission': 'create_mission',
    'create mission: sell Sentinel': 'create_mission',
    'sell Sentinel': 'create_mission',
    'research banks': 'create_mission',
    'generate proposal': 'create_mission',
    'contact hospitals': 'create_mission',
    'run campaign': 'campaign',
    'build campaign': 'campaign',
    'run sales': 'run_sales',
    'show revenue': 'revenue',
    'my deals': 'deals',
    'find customers': 'find_customers',
    'add customer: Acme Corp': 'new_customer',
    'why not work': 'error_report',
    'fix error': 'error_report',
    'approve': 'approve',
    'cancel': 'cancel',
    'continue': 'continue',
    'status': 'status',
    'show analytics': 'analytics',
    'help': 'help',
    'التحليلات': 'analytics',
    'تشغيل المبيعات': 'run_sales',
    'موافقة': 'approve',
    'مساعدة': 'help',
    'أضف عميل': 'new_customer',
    'مهمة جديدة': 'create_mission',
    'الحالة': 'status',
    'حملة': 'campaign',
    'search the knowledge base for pricing': 'knowledge',
    'what do we know about Elmahrosa': 'knowledge',
    'ابحث في قاعدة المعرفة عن الأسعار': 'knowledge',
    'knowledge base': 'knowledge',
    'trust': 'trust',
    'security': 'trust',
    'security center': 'trust',
    'compliance': 'trust',
    'credentials': 'trust',
    'certification': 'trust',
    'how secure is the platform': 'trust',
    'الأمان': 'trust',
    'الثقة': 'trust',
    'الاعتمادات': 'trust',
    'الشهادات': 'trust',
    'هل النظام آمن؟': 'trust'
  };
  for (const [text, expected] of Object.entries(cases)) {
    const d = intent.detect(text);
    equal(d.intent, expected, `intent("${text}") === ${expected}`);
  }
  equal(intent.detect('السلام عليكم').language, 'ar', 'Arabic detected as ar');
  equal(intent.detect('hello').language, 'en', 'English detected as en');
  equal(intent.detect('sell Sentinel').params.goal, 'sell Sentinel', 'goal captured from "sell X"');
  equal(intent.detect('search the knowledge base for pricing').params.query, 'pricing', 'knowledge query captured');

  // --------------------------------------------- Router pipeline (Phase 2)
  const r1 = await router.handleText(adapter, FOUNDER, 'hello');
  check(Boolean(r1.text), 'greeting reply produced');
  check(!r1.text.includes('/start'), 'no /start fallback in router reply');
  check(r1.suggestions.length > 0, 'reply carries next-step suggestions');

  // ------------------------------------------ Founder bypass (Phase 7)
  const r2 = await router.handleText(adapter, FOUNDER, 'show me pricing');
  equal(r2.trace.intent, 'pricing', 'pricing intent detected for founder');
  equal(r2.trace.decision, 'deny', 'billing.view denied for founder at the policy gate');
  check(!/upgrade|subscribe|\bpay\b|\$/.test(r2.text), 'founder never sees billing/upsell text');

  // ----------------------------------------- Native Arabic (Phase 6)
  const r3 = await router.handleText(adapter, FOUNDER, 'مرحبا');
  check(/[\u0600-\u06FF]/.test(r3.text), 'Arabic greeting answered with native Arabic');
  check(!/\/start/.test(r3.text), 'Arabic reply has no /start');

  // ----------------------------------------- Trust & Security (Final order)
  equal(intent.detect('credentials').params.credentials, true, 'credentials param set for credential request');
  equal(intent.detect('security').params.credentials, false, 'credentials param not set for generic security');
  const t1 = await router.handleText(adapter, FOUNDER, 'security');
  equal(t1.trace.intent, 'trust', 'security intent routed as trust');
  check(t1.text.includes('elmahrosa.org/trust'), 'trust reply links the Trust Center');
  check(!t1.text.includes('/start'), 'trust reply has no /start fallback');
  const t2 = await router.handleText(adapter, FOUNDER, 'show me your credentials');
  check(t2.text.includes('credly.com'), 'credential request reply includes the verified Credly badge');
  const t3 = await router.handleText(adapter, FOUNDER, 'الأمان');
  check(/[\u0600-\u06FF]/.test(t3.text) && t3.text.includes('elmahrosa.org/trust'), 'Arabic security intent answered with Trust Center link');
  check(!t3.text.includes('/start'), 'Arabic trust reply has no /start fallback');
  const t4 = await router.handleText(adapter, FOUNDER, 'الاعتمادات');
  check(t4.text.includes('credly.com'), 'Arabic credential request reply includes the verified Credly badge');

  // ----------------------------------------- Memory continuity (Phase 5)
  const r4 = await router.handleText(adapter, FOUNDER, 'create mission');
  equal(r4.session.currentIntent, 'create_mission', 'currentIntent persisted across turns');
  check(r4.session.missingInformation.includes('goal'), 'missingInformation records the goal follow-up');
  const r5 = await router.handleText(adapter, FOUNDER, 'status');
  equal(r5.session.currentIntent, 'status', 'currentIntent updates across turns');
  check(r5.session.recentConversation.length >= 4, 'conversation history persists across turns');

  // ----------------------------- Mission creation by natural language
  const r6 = await router.handleText(adapter, FOUNDER, 'create mission: sell TEOS DealMaker');
  equal(r6.trace.action, 'create_mission', 'mission created by natural language');
  const plans2 = await repos.plans.list(wsId);
  check(plans2.some(p => p.goal === 'sell TEOS DealMaker'), 'mission row persisted with goal');

  // ----------------------------- Customer creation by natural language
  const r7 = await router.handleText(adapter, FOUNDER, 'add customer: Acme Holdings');
  equal(r7.trace.action, 'new_customer', 'customer created by natural language');
  const deals = await repos.deals.list(wsId, { status: 'open' });
  check(deals.some(d => d.company_name === 'Acme Holdings'), 'Acme Holdings persisted in pipeline');

  // ----------------------------- Knowledge search through the router
  await repos.intelligence.add({ workspace_id: wsId, title: 'TEOS pricing playbook', source_type: 'playbook', content: 'TEOS DealMaker annual pricing tiers for enterprise customers.', metadata: null });
  const r7b = await router.handleText(adapter, FOUNDER, 'search the knowledge base for TEOS pricing');
  equal(r7b.trace.action, 'knowledge', 'knowledge search executed through router');
  check(r7b.text.includes('pricing playbook'), 'knowledge reply surfaces the top hit');
  const r7c = await router.handleText(adapter, FOUNDER, 'search the knowledge base for zzzzqqqqwwww');
  check(r7c.text.includes('Nothing found'), 'empty knowledge result handled gracefully');

  // ----------------------------- Smart error recovery (Phase 11)
  const repaired = executor.selfRepair({ intent: 'run_sales', language: 'en' }, { isFounder: true, language: 'en' }, new Error('400 Bad Request'));
  equal(repaired.action, 'diagnostics', 'raw 400 converted to diagnostics action');
  equal(repaired.data.repair, true, 'repair flag set on diagnostics');

  // ----------------------------- Customer mode gating (Phase 8)
  await identity.ensureUser(adapter, CUSTOMER, { display_name: 'Customer One' });
  await identity.onboardWorkspace(adapter, { ownerUserId: (await identity.getUserByTelegram(adapter, CUSTOMER)).id, companyName: 'Customer One Ltd', lang: 'en' });
  const r8 = await router.handleText(adapter, CUSTOMER, 'fix error');
  equal(r8.trace.decision, 'deny', 'diagnostics (founder-only) denied for a customer at the policy gate');

  // ----------------------------- Trust intent for customers (Final order)
  const r8b = await router.handleText(adapter, CUSTOMER, 'trust center');
  equal(r8b.trace.intent, 'trust', 'customer trust request routed as trust');
  check(r8b.text.includes('elmahrosa.org/trust'), 'customer trust reply links the Trust Center');
  check(!r8b.text.includes('/start'), 'customer trust reply has no /start fallback');

  console.log(`\nPASS ${n} assertions (test-v11-router)`);
  process.exit(0);
})().catch(err => {
  console.error('test-v11-router FAILED:', err && err.stack || err);
  process.exit(1);
});

