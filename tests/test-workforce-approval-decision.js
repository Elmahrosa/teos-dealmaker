// tests/test-workforce-approval-decision.js
//
// Regression test for the reject-approves bug. The bot's Approvals screen
// rendered a "Reject #<id>" button (cc_appr:<id>:reject) but the callback
// handler hardcoded 'approve', so clicking Reject approved the gate.
//
// This test pins the corrected contract of runtime.approveAndResume:
//   - an explicit 'approve' decision approves and resumes the plan
//   - an explicit 'reject' decision rejects the request, does NOT resume
//     the plan, and the gated step is skipped (never executed) on resume
//   - the default (no decision arg) keeps the historic approve behavior so
//     existing callers are unchanged
'use strict';

const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');
const runtime = require('../services/workforce/runtime');

(async () => {
  let n = 0;
  const check = (cond, msg) => { assert.ok(cond, msg); n += 1; };
  const equal = (a, b, msg) => { assert.strictEqual(a, b, msg); n += 1; };

  const adapter = createMemoryAdapter();
  const tg = 7710001;
  await identity.ensureUser(adapter, tg, { display_name: 'Approval Founder' });
  const user = await identity.getUserByTelegram(adapter, tg);
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: user.id,
    companyName: 'Approval Runtime',
    lang: 'en',
    plan: 'growth'
  });
  const wsId = ws.id;
  const repos = createRepos(adapter);
  const sub = await repos.subscriptions.get(wsId);
  await repos.subscriptions.update(sub.id, { status: 'active' });

  // ------------------------------------------------------------------
  // Explicit APPROVE path: request approved, plan resumes and completes,
  // the gated send step actually runs.
  // ------------------------------------------------------------------
  const approvePlan = await runtime.runGoal(adapter, wsId,
    'Prepare and send a proposal to Approve Corp', { title: 'Approve proposal' });
  equal(approvePlan.status, 'waiting_approval', 'approve-plan halts for approval');
  const approveReq = approvePlan.pendingApprovals[0];
  check(approveReq && approveReq.requestId, 'approve-plan has a pending request');

  const approveOutcome = await runtime.approveAndResume(adapter, wsId, approveReq.requestId, tg, 'approve');
  equal(approveOutcome.decision.status, 'approved', 'explicit approve marks the request approved');
  equal(approveOutcome.resumed, true, 'explicit approve resumes the plan');
  equal(approveOutcome.status, 'completed', 'approved plan completes');
  equal(approveOutcome.steps.find(s => s.step_key === 'send').status, 'completed', 'approved send step runs');

  const approveStored = await repos.approvals.get(wsId, approveReq.requestId);
  equal(approveStored.status, 'approved', 'approved request persisted as approved');

  // ------------------------------------------------------------------
  // Explicit REJECT path: request rejected, plan NOT resumed, the gated
  // step is skipped (never runs) when the plan is resumed later.
  // ------------------------------------------------------------------
  const rejectPlan = await runtime.runGoal(adapter, wsId,
    'Prepare and send a proposal to Reject Corp', { title: 'Reject proposal' });
  equal(rejectPlan.status, 'waiting_approval', 'reject-plan halts for approval');
  const rejectReq = rejectPlan.pendingApprovals[0];
  check(rejectReq && rejectReq.requestId, 'reject-plan has a pending request');

  const rejectOutcome = await runtime.approveAndResume(adapter, wsId, rejectReq.requestId, tg, 'reject');
  equal(rejectOutcome.decision.status, 'rejected', 'explicit reject marks the request rejected');
  equal(rejectOutcome.resumed, false, 'reject does not resume the plan');

  const rejectStored = await repos.approvals.get(wsId, rejectReq.requestId);
  equal(rejectStored.status, 'rejected', 'rejected request persisted as rejected');

  const resumedAfterReject = await runtime.resume(adapter, wsId, rejectPlan.plan.id);
  equal(resumedAfterReject.status, 'completed', 'plan can still reach a terminal state after rejection');
  equal(resumedAfterReject.steps.find(s => s.step_key === 'send').status, 'skipped', 'rejected send step is skipped, never executed');

  // ------------------------------------------------------------------
  // Default (no decision) preserves the historic approve semantics so
  // callers that did not pass a decision keep working unchanged.
  // ------------------------------------------------------------------
  const defaultPlan = await runtime.runGoal(adapter, wsId,
    'Prepare and send a proposal to Default Corp', { title: 'Default proposal' });
  const defaultReq = defaultPlan.pendingApprovals[0];
  const defaultOutcome = await runtime.approveAndResume(adapter, wsId, defaultReq.requestId, tg);
  equal(defaultOutcome.decision.status, 'approved', 'default decision is approve (backward compatible)');
  equal(defaultOutcome.resumed, true, 'default approve resumes the plan');
  equal(defaultOutcome.status, 'completed', 'default-approve plan completes');

  // ------------------------------------------------------------------
  // Unknown decision strings cannot subvert the gate into a non-decision.
  // ------------------------------------------------------------------
  const junkPlan = await runtime.runGoal(adapter, wsId,
    'Prepare and send a proposal to Junk Corp', { title: 'Junk proposal' });
  const junkReq = junkPlan.pendingApprovals[0];
  const junkOutcome = await runtime.approveAndResume(adapter, wsId, junkReq.requestId, tg, 'maybe');
  equal(junkOutcome.decision.status, 'approved', 'non-reject decision strings fall back to approve');

  console.log(`\n\u2713 workforce approval decision (${n} assertions passed)`);
  console.log('  explicit approve · explicit reject · skipped-not-run · default approve');
  process.exit(0);
})().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
