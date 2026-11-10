// Regression tests for typed (natural-language) approvals, English + Arabic.
// Bug: executor passed 'approved'/'rejected' to approvals.decide(), which only
// accepts 'approve'/'reject', so typing "approve" stored a REJECTION and then
// resumed the mission. Mocks / in-memory adapter only: no network, no email.

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.TELEGRAM_ADMIN_IDS = '8800101';
process.env.TEOS_FOUNDER_TELEGRAM_ID = '8800101';
process.env.DATABASE_URL = '';

const assert = require('assert');
const { createMemoryAdapter, createRepos } = require('../db');
const founderSeed = require('../services/founderSeed');
const founderMission = require('../services/founderMission');
const identity = require('../services/identity');
const router = require('../services/router');
const memory = require('../services/router/memory');
const intent = require('../services/router/intent');

const FOUNDER = 8800101;
const OUTSIDER = 8800102;
const UNLINKED = 8800103;

let n = 0;
const check = (c, m) => { assert.ok(c, m); n += 1; };
const equal = (a, b, m) => { assert.strictEqual(a, b, m); n += 1; };

async function freshFounderWithPending() {
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);
  memory.reset();
  const seed = await founderSeed.bootstrapFounder(adapter);
  const wsId = seed.workspace.id;
  const plan = (await repos.plans.list(wsId))[0];
  await repos.plans.update(wsId, plan.id, { status: 'running' });
  const run = await founderMission.autoStartFounderMission(adapter, wsId);
  equal(run.status, 'waiting_approval', 'fixture: mission waits for approval');
  const pending = await repos.approvals.list(wsId, 'pending');
  equal(pending.length, 1, 'fixture: exactly one pending approval');
  return { adapter, repos, wsId, plan, approval: pending[0] };
}

const statusOf = async (repos, wsId, id) => (await repos.approvals.get(wsId, id)).status;
const planStatus = async (repos, wsId, id) => (await repos.plans.get(wsId, id)).status;

(async () => {
  // ---- intent detection: anchoring + ids
  const d = (t) => intent.detect(t);
  equal(d('موافق').intent, 'approve', 'AR standalone موافق approves');
  equal(d('موافقة').intent, 'approve', 'AR موافقة approves');
  equal(d('أوافق').intent, 'approve', 'AR أوافق approves');
  equal(d('موافقة 126').params.requestId, 126, 'AR id 126 parsed');
  equal(d('موافق على ١٢٦').params.requestId, 126, 'AR-Indic digits parsed');
  equal(d('رفض').intent, 'cancel', 'AR رفض rejects');
  equal(d('ارفض 126').params.requestId, 126, 'AR reject id parsed');
  equal(d('approve 126').params.requestId, 126, 'EN short id parsed');
  equal(d('reject 5').intent, 'cancel', 'EN reject');
  equal(d('reject 5').params.requestId, 5, 'EN reject id parsed');
  for (const t of ['نعم، أرسل لهم تقرير المبيعات', 'تمام شكرا على المعلومات', 'لا أريد ذلك', 'هل الأمر تمام؟', 'موافق لكن غيّر العنوان']) {
    check(!['approve', 'cancel'].includes(d(t).intent), `unrelated sentence must not decide: ${t}`);
  }

  // ---- question marks never decide; multiple ids are ambiguous
  for (const t of ['موافق؟', 'موافقة 126؟', 'رفض؟', 'approve?', 'approve 12?', 'reject?', 'reject 12 ?', 'ok?']) {
    check(!['approve', 'cancel'].includes(d(t).intent), `question must not decide: ${t}`);
  }
  for (const t of ['موافق', 'موافق.', 'موافق!', 'رفض', 'approve', 'approve.', 'approve!', 'reject']) {
    check(['approve', 'cancel'].includes(d(t).intent), `valid standalone command still decides: ${t}`);
  }
  equal(d('approve 12').params.requestId, 12, 'single id still selects');
  equal(d('approve #12').params.requestId, 12, 'single #id still selects');
  equal(d('reject 12').params.requestId, 12, 'single reject id still selects');
  for (const t of ['approve 12 13', 'reject 12 and 13', 'approve 12, 13']) {
    const r = d(t);
    check(r.params.ambiguousIds === true && r.params.requestId === undefined, `multiple ids flagged ambiguous: ${t}`);
  }

  // ---- AR approve, single pending: persisted approved + mission resumed
  {
    const { adapter, repos, wsId, plan, approval } = await freshFounderWithPending();
    const r = await router.handleText(adapter, FOUNDER, 'موافق');
    equal(await statusOf(repos, wsId, approval.id), 'approved', 'AR approve persists approved');
    check(r.text.startsWith('تمت الموافقة'), 'AR reply says approved');
    check(!r.text.includes('تم الرفض') && !r.text.includes('الإلغاء'), 'AR reply is not a rejection');
    equal(await planStatus(repos, wsId, plan.id), 'completed', 'approved request resumes the mission');
    const again = await router.handleText(adapter, FOUNDER, 'موافق');
    check(again.text.includes('لا توجد'), 'repeat approval reports nothing pending');
    equal(await statusOf(repos, wsId, approval.id), 'approved', 'repeat does not flip status');
  }

  // ---- EN approve, single pending
  {
    const { adapter, repos, wsId, plan, approval } = await freshFounderWithPending();
    const r = await router.handleText(adapter, FOUNDER, 'approve');
    equal(await statusOf(repos, wsId, approval.id), 'approved', 'EN approve persists approved');
    check(r.text.startsWith('Approved.'), 'EN reply says approved');
    check(!/Cancelled|Rejected/.test(r.text), 'EN reply is not a rejection');
    equal(await planStatus(repos, wsId, plan.id), 'completed', 'EN approve resumes mission');
  }

  // ---- reject (EN + AR) never resumes
  for (const [msg, okText] of [['reject', 'Rejected.'], ['رفض', 'تم الرفض.']]) {
    const { adapter, repos, wsId, plan, approval } = await freshFounderWithPending();
    const r = await router.handleText(adapter, FOUNDER, msg);
    equal(await statusOf(repos, wsId, approval.id), 'rejected', `${msg} persists rejected`);
    equal(r.text, okText, `${msg} reply is exactly a rejection`);
    check(!/resumed|استؤنفت/.test(r.text), `${msg} reply never mentions resuming`);
    equal(await planStatus(repos, wsId, plan.id), 'waiting_approval', `${msg} does not resume the mission`);
  }

  // ---- explicit short id
  {
    const { adapter, repos, wsId, approval } = await freshFounderWithPending();
    check(String(approval.id).length < 6, 'fixture id is a short id');
    await router.handleText(adapter, FOUNDER, `approve ${approval.id}`);
    equal(await statusOf(repos, wsId, approval.id), 'approved', 'approve <short id> works');
  }
  {
    const { adapter, repos, wsId, approval } = await freshFounderWithPending();
    await router.handleText(adapter, FOUNDER, `رفض ${approval.id}`);
    equal(await statusOf(repos, wsId, approval.id), 'rejected', 'رفض <short id> works');
  }

  // ---- question mark and multi-id decide nothing end to end
  {
    const { adapter, repos, wsId, plan, approval } = await freshFounderWithPending();
    const second = await repos.approvals.create({ workspace_id: wsId, plan_id: plan.id, step_id: null, agent_type: 'sales', reason: 'second request' });
    const sid = second.id || (await repos.approvals.list(wsId, 'pending')).find((a) => a.id !== approval.id).id;
    const r = await router.handleText(adapter, FOUNDER, `approve ${approval.id} ${sid}`);
    equal(await statusOf(repos, wsId, approval.id), 'pending', 'multi-id approve does not decide the first id');
    equal(await statusOf(repos, wsId, sid), 'pending', 'multi-id approve does not decide the second id');
    check(r.text.includes(`#${approval.id}`) && r.text.includes(`#${sid}`), 'multi-id reply lists the pending requests');
    await router.handleText(adapter, FOUNDER, 'approve?');
    await router.handleText(adapter, FOUNDER, 'موافق؟');
    equal(await statusOf(repos, wsId, approval.id), 'pending', 'question marks decide nothing');
    equal(await statusOf(repos, wsId, sid), 'pending', 'question marks decide nothing (2)');
  }
  {
    const { adapter, repos, wsId, approval } = await freshFounderWithPending();
    await router.handleText(adapter, FOUNDER, 'approve?');
    equal(await statusOf(repos, wsId, approval.id), 'pending', 'single pending + question mark decides nothing');
    await router.handleText(adapter, FOUNDER, 'approve');
    equal(await statusOf(repos, wsId, approval.id), 'approved', 'valid standalone approve still works');
  }

  // ---- unknown id: nothing decided
  {
    const { adapter, repos, wsId, approval } = await freshFounderWithPending();
    const r = await router.handleText(adapter, FOUNDER, 'approve 999999');
    equal(await statusOf(repos, wsId, approval.id), 'pending', 'unknown id decides nothing');
    check(r.text.includes('999999'), 'reply names the missing id');
  }

  // ---- no pending
  {
    const { adapter, repos, wsId, approval } = await freshFounderWithPending();
    await repos.approvals.update(wsId, approval.id, { status: 'rejected' });
    const en = await router.handleText(adapter, FOUNDER, 'approve');
    check(en.text.startsWith('No pending approval'), 'EN no pending message');
    const ar = await router.handleText(adapter, FOUNDER, 'موافق');
    check(ar.text.includes('لا توجد طلبات موافقة معلقة'), 'AR no pending message');
  }

  // ---- multiple pending: ask, never guess; id selects one
  {
    const { adapter, repos, wsId, plan, approval } = await freshFounderWithPending();
    const second = await repos.approvals.create({ workspace_id: wsId, plan_id: plan.id, step_id: null, agent_type: 'sales', reason: 'second request' });
    const sid = second.id || (await repos.approvals.list(wsId, 'pending')).find((a) => a.id !== approval.id).id;
    const r = await router.handleText(adapter, FOUNDER, 'approve');
    equal(await statusOf(repos, wsId, approval.id), 'pending', 'ambiguous approve decides nothing (1)');
    equal(await statusOf(repos, wsId, sid), 'pending', 'ambiguous approve decides nothing (2)');
    check(r.text.includes(`#${approval.id}`) && r.text.includes(`#${sid}`), 'reply lists both pending ids');
    const ar = await router.handleText(adapter, FOUNDER, 'موافق');
    equal(await statusOf(repos, wsId, approval.id), 'pending', 'ambiguous AR approve decides nothing');
    check(ar.text.includes('موافقات معلقة'), 'AR reply asks which request');
    await router.handleText(adapter, FOUNDER, `reject ${sid}`);
    equal(await statusOf(repos, wsId, sid), 'rejected', 'id selects the chosen request');
    equal(await statusOf(repos, wsId, approval.id), 'pending', 'the other request is untouched');
  }

  // ---- stale session id must never be used
  {
    const { adapter, repos, wsId, plan, approval } = await freshFounderWithPending();
    await repos.approvals.create({ workspace_id: wsId, plan_id: plan.id, step_id: null, agent_type: 'sales', reason: 'second request' });
    memory.update(FOUNDER, { approvalState: { requestId: approval.id } });
    const r = await router.handleText(adapter, FOUNDER, 'approve');
    equal(await statusOf(repos, wsId, approval.id), 'pending', 'stale session approvalState is ignored');
    check(r.text.includes('pending approvals'), 'asks the user to choose instead');
  }

  // ---- authorization: other workspace / unlinked users cannot decide
  {
    const { adapter, repos, wsId, approval } = await freshFounderWithPending();
    await identity.ensureUser(adapter, OUTSIDER, { display_name: 'Outsider' });
    await identity.onboardWorkspace(adapter, { ownerUserId: (await identity.getUserByTelegram(adapter, OUTSIDER)).id, companyName: 'Outsider Ltd', lang: 'en' });
    const r1 = await router.handleText(adapter, OUTSIDER, 'approve');
    const r2 = await router.handleText(adapter, OUTSIDER, `approve ${approval.id}`);
    equal(await statusOf(repos, wsId, approval.id), 'pending', 'other-workspace user cannot decide');
    check(/No pending|no pending/.test(r1.text + r2.text), 'outsider is told nothing is pending');
    const r3 = await router.handleText(adapter, UNLINKED, 'approve');
    equal(await statusOf(repos, wsId, approval.id), 'pending', 'unlinked user cannot decide');
    check(/\/start/.test(r3.text), 'unlinked user is told to /start');
  }

  console.log(`✓ typed approvals (${n} assertions passed)`);
})().catch((err) => {
  console.error('FAIL:', err && err.stack || err);
  process.exit(1);
});
