// tests/test-customer0.js
// Customer #0 self-sale: TEOS DealMaker sells to DealMaker.
// Exercises the deterministic scorecard, the idempotent seed (drafts only),
// the governed decision surface (approve/reject/expiry/batch), founder-session
// authorization (forged/expired/non-founder rejected), the no-send guarantee
// while the outbound worker is paused, and the Customer #0 section of the
// founder report (including the NO MATERIAL CHANGE line).
'use strict';

const assert = require('assert');
const dbMod = require('../db');

process.env.TEOS_FOUNDER_TELEGRAM_ID = '7770001';
process.env.SOR_ENABLED = 'true';
process.env.SOR_APPROVAL_TTL_HOURS = '48';
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM;

async function main() {
  console.log('🧪 Customer #0 Self-Sale Test\n');

  const adapter = dbMod.createMemoryAdapter();
  const r = dbMod.createRepos(adapter);
  const db = { adapter, pg: null, repos: r };
  const customer0 = require('../services/customer0');
  const scorecard = require('../services/revenueOps/scorecard');
  const revenueOps = require('../services/revenueOps');

  // ------------------------------------------------------------------ scorecard
  assert.ok(Math.abs(scorecard.weightsSum() - 1) < 1e-9, 'dimension weights sum to 1.0');
  assert.strictEqual(scorecard.DIMENSIONS.length, 11, 'eleven deterministic dimensions');

  const bostaCandidate = customer0.CUSTOMER0_SEED_PROSPECTS[0];
  const bostaCard = scorecard.scoreProspect(bostaCandidate);
  assert.ok(bostaCard.score >= 70, 'Bosta scores >= 70 (priority A)');
  assert.strictEqual(bostaCard.priority, 'A', 'Bosta priority A');
  assert.strictEqual(bostaCard.sentinel_verdict, 'APPROVE', 'Bosta Sentinel verdict APPROVE');
  assert.strictEqual(bostaCard.reasons.length, 11, 'one explainable reason per dimension');

  const blankCard = scorecard.scoreProspect({ metadata: {} });
  assert.strictEqual(blankCard.score, 0, 'no-signal candidate scores 0');
  assert.strictEqual(blankCard.sentinel_verdict, 'HOLD', 'no-signal verdict HOLD');

  const rec = scorecard.recommendTop([
    bostaCandidate,
    customer0.CUSTOMER0_SEED_PROSPECTS[1]
  ]);
  assert.strictEqual(rec.top.company_name, 'Bosta', 'Bosta ranked first by the scorecard');

  // ------------------------------------------------------------------ seed
  const s1 = await customer0.seed(db, {});
  assert.strictEqual(s1.seeded, true, 'seed runs');
  assert.strictEqual(s1.createdProspects, 2, 'two prospects created');
  assert.strictEqual(s1.createdEmails, 1, 'one governed outreach draft (Bosta)');
  assert.ok(s1.note.includes('Nothing was sent'), 'seed states nothing was sent');

  const s2 = await customer0.seed(db, {});
  assert.strictEqual(s2.createdProspects, 0, 'seed is idempotent — no new prospects');
  assert.strictEqual(s2.createdEmails, 0, 'seed is idempotent — no new emails');

  const bosta = await adapter.findOne('prospects', { company_name: 'Bosta' });
  assert.strictEqual(bosta.status, 'ACTIVE', 'Bosta prospect active');
  assert.strictEqual(bosta.sentinel_verdict, 'APPROVE', 'prospect stores the scorecard verdict');
  assert.ok(bosta.metadata && bosta.metadata.dimensions, 'prospect stores scored dimensions');

  const ws = await adapter.findOne('workspaces', { slug: 'workspace_founder' });
  assert.ok(ws, 'founder workspace provisioned');

  // ------------------------------------------------------------------ review queue
  const queue = await customer0.pendingOutreach(db, {});
  assert.strictEqual(queue.length, 1, 'exactly one pending outreach');
  const q = queue[0];
  assert.strictEqual(q.company, 'Bosta', 'queue shows company');
  assert.strictEqual(q.channel, 'email', 'queue shows channel');
  assert.strictEqual(q.status, 'PENDING_APPROVAL', 'draft waits for founder approval');
  assert.ok(q.links.approve.startsWith('https://'), 'approval link is absolute https');
  assert.ok(q.links.approve.includes('/approvals/customer0'), 'approval link resolves to the governed review surface');

  // Secret-leak guard: even with keys set, the review queue never exposes them.
  process.env.RESEND_API_KEY = 're_secretkey_test';
  process.env.AUDIT_API_KEY = 'audit_secret_value';
  const blob = JSON.stringify({ queue: await customer0.pendingOutreach(db, {}) });
  assert.ok(!blob.includes('re_secretkey_test'), 'queue must not leak RESEND_API_KEY');
  assert.ok(!blob.includes('audit_secret_value'), 'queue must not leak AUDIT_API_KEY');
  delete process.env.RESEND_API_KEY;

  // ------------------------------------------------------------------ founder-session authorization
  const identity = require('../services/identity');
  const session = require('../services/session');
  const founderUser = await identity.ensureUser(adapter, Number(process.env.TEOS_FOUNDER_TELEGRAM_ID), { display_name: 'Founder' });
  assert.ok(await identity.isFounderUser(adapter, founderUser.id), 'founder user recognized by identity');

  const mw = session.createRequireFounderSession(() => adapter);
  const mkRes = () => ({ statusCode: 0, json(o) { this.body = o; return this; }, status(s) { this.statusCode = s; return this; }, send(o) { this.body = o; return this; } });
  const mkReq = token => {
    const headers = { authorization: 'Bearer ' + token };
    return { headers, get: h => headers[h.toLowerCase()] };
  };

  let nextCalled = false;
  const forged = mkReq('forgedtokenforgedtokenforgedtokenforgedtoken123');
  const forgedRes = mkRes();
  await mw(forged, forgedRes, () => { nextCalled = true; });
  assert.strictEqual(forgedRes.statusCode, 401, 'forged session token rejected (401)');
  assert.ok(!nextCalled, 'forged session never reaches the handler');

  const { token } = await session.createSession(adapter, founderUser.id);
  const okReq = mkReq(token);
  const okRes = mkRes();
  nextCalled = false;
  await mw(okReq, okRes, () => { nextCalled = true; });
  assert.ok(nextCalled, 'valid founder session reaches the handler');
  assert.strictEqual(okReq.authUser.id, founderUser.id, 'req.authUser is the founder');

  const other = await identity.ensureUser(adapter, 123456, { display_name: 'Other' });
  const { token: otherToken } = await session.createSession(adapter, other.id);
  const otherReq = mkReq(otherToken);
  const otherRes = mkRes();
  nextCalled = false;
  await mw(otherReq, otherRes, () => { nextCalled = true; });
  assert.strictEqual(otherRes.statusCode, 403, 'non-founder session rejected (403)');
  assert.ok(!nextCalled, 'non-founder never reaches the handler');

  const { token: expToken } = await session.createSession(adapter, founderUser.id);
  const expSession = await r.sessions.getByTokenHash(session.hashToken(expToken));
  await adapter.update('sessions', { id: expSession.id }, { expires_at: new Date(Date.now() - 1000).toISOString() });
  const expReq = mkReq(expToken);
  const expRes = mkRes();
  nextCalled = false;
  await mw(expReq, expRes, () => { nextCalled = true; });
  assert.strictEqual(expRes.statusCode, 401, 'expired session token rejected (401)');
  assert.ok(!nextCalled, 'expired session never reaches the handler');

  // ------------------------------------------------------------------ approve (governed)
  const founderArg = { id: founderUser.id, email: 'founder@teosegypt.com' };
  const approval = await customer0.decide(db, { id: q.id, decision: 'approve', founder: founderArg });
  assert.strictEqual(approval.ok, true, 'governed approve succeeds');
  assert.strictEqual(approval.status, 'approved', 'status approved');
  assert.ok(approval.enqueue, 'enqueue attempt recorded');
  assert.strictEqual(approval.enqueue.ok, false, 'enqueue blocked while worker paused');
  assert.strictEqual(approval.enqueue.error, 'outreach_paused', 'blocked because outbound is paused');

  const storedEmail = await r.outboundEmails.get(ws.id, q.id);
  assert.ok(storedEmail.approved_at, 'approval timestamp stamped on the draft');
  assert.strictEqual(storedEmail.approved_by, 'founder@teosegypt.com', 'approver recorded on the draft');
  assert.strictEqual(storedEmail.status, 'PENDING_APPROVAL', 'approval alone never sends — lifecycle status preserved');

  const jobs = await r.outboundJobs.list(ws.id, {});
  assert.strictEqual(jobs.length, 0, 'no outbound job created (worker paused, OUTREACH off)');

  // ------------------------------------------------------------------ duplicate + audit trail
  const dup = await customer0.decide(db, { id: q.id, decision: 'approve', founder: founderArg });
  assert.strictEqual(dup.ok, false, 'duplicate approve refused');
  assert.strictEqual(dup.error, 'already_decided', 'duplicate reported as already_decided');

  const audits = await r.audit.list(null, {});
  const types = audits.map(a => a.action_type);
  assert.ok(types.includes('CUSTOMER0_OUTREACH_APPROVED'), 'approval audit entry emitted');
  assert.ok(types.includes('CUSTOMER0_OUTREACH_ENQUEUE'), 'enqueue-attempt audit entry emitted');
  assert.ok(types.includes('CUSTOMER0_OUTREACH_DUPLICATE'), 'duplicate-decision audit entry emitted');

  // ------------------------------------------------------------------ reject path
  const ch = customer0._channel();
  const draft2 = await ch.createDraft(r, {
    workspace_id: ws.id,
    to: 'ops@pushbots.co',
    from: 'info@elmahrosa.org',
    subject: 'PushBots GTM capacity',
    body: 'Hello PushBots team,\n\nA governed 30-minute demo of our revenue workforce.\n\nElmahrosa',
    campaign: 'customer0:prospect_2'
  });
  await ch.requestApproval(r, ws.id, draft2.email.id, { reason: 'customer0 outreach' });
  const rej = await customer0.decide(db, { id: draft2.email.id, decision: 'reject', founder: founderArg, reason: 'not ready' });
  assert.strictEqual(rej.ok, true, 'governed reject succeeds');
  assert.strictEqual(rej.status, 'rejected', 'status rejected');
  const rejEmail = await r.outboundEmails.get(ws.id, draft2.email.id);
  assert.strictEqual(rejEmail.status, 'REJECTED', 'email marked REJECTED');
  assert.strictEqual(rejEmail.failure_reason, 'not ready', 'rejection reason recorded');
  assert.ok((await r.audit.list(null, {})).map(a => a.action_type).includes('CUSTOMER0_OUTREACH_REJECTED'), 'reject audit entry emitted');

  // ------------------------------------------------------------------ wrong state / scope
  const notFound = await customer0.decide(db, { id: 999999, decision: 'approve', founder: founderArg });
  assert.strictEqual(notFound.error, 'not_found', 'unknown id is not governed');
  const foreign = await ch.createDraft(r, {
    workspace_id: ws.id,
    to: 'x@y.co',
    from: 'info@elmahrosa.org',
    subject: 'other campaign',
    body: 'hi',
    campaign: 'other:1'
  });
  const foreignRes = await customer0.decide(db, { id: foreign.email.id, decision: 'approve', founder: founderArg });
  assert.strictEqual(foreignRes.error, 'not_found', 'non-customer0 draft is outside the governed queue');

  // ------------------------------------------------------------------ expiry
  const draft3 = await ch.createDraft(r, {
    workspace_id: ws.id,
    to: 'ceo@bosta.co',
    from: 'info@elmahrosa.org',
    subject: 'Bosta follow-up',
    body: 'Hi Mohamed,\n\nFollowing up on the live demo.\n\nElmahrosa',
    campaign: 'customer0:prospect_1'
  });
  await ch.requestApproval(r, ws.id, draft3.email.id, { reason: 'customer0 outreach' });
  const past = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
  await r.outboundEmails.update(ws.id, draft3.email.id, { requested_at: past, created_at: past });
  const expired = await customer0.decide(db, { id: draft3.email.id, decision: 'approve', founder: founderArg });
  assert.strictEqual(expired.error, 'expired', 'expired approval refused');
  const expEmail = await r.outboundEmails.get(ws.id, draft3.email.id);
  assert.strictEqual(expEmail.status, 'REJECTED', 'expired draft marked REJECTED');
  assert.ok((await r.audit.list(null, {})).map(a => a.action_type).includes('CUSTOMER0_OUTREACH_EXPIRED'), 'expired audit entry emitted');

  // ------------------------------------------------------------------ batch
  const batch = await customer0.batchDecide(db, { ids: [999999, 888888], decision: 'approve', founder: founderArg });
  assert.strictEqual(batch.ok, true, 'batch runs to completion');
  assert.strictEqual(batch.decided, 0, 'batch decides nothing on not-found ids');
  assert.strictEqual(batch.skipped, 2, 'batch skips every not-found id without aborting');

  // ------------------------------------------------------------------ report integration
  const reportMod = revenueOps._report;
  const interval = 3 * 60 * 60 * 1000;
  const win = reportMod.windowEndOf(Date.now(), interval);
  const res = await reportMod.generateAndSend(db, win - interval, win);
  assert.strictEqual(res.delivery.ok, false, 'report fails closed without RESEND key');
  assert.strictEqual(res.delivery.reason, 'resend_not_configured', 'report send refused (fail-closed)');
  assert.ok(res.metrics.customer0, 'report metrics carry the customer0 section');
  assert.strictEqual(res.metrics.customer0.topOpportunity, 'Bosta', 'top opportunity surfaced in the report');
  assert.strictEqual(res.metrics.customer0.materialChange, true, 'first report is a material change');

  const rows = await r.founderReports.list({});
  assert.strictEqual(rows.length, 1, 'one report persisted');
  assert.ok(rows[0].subject.includes('Customer #0'), 'report subject carries Customer #0');

  const sectionText = customer0.renderCustomer0Text(await customer0.buildReportSection(db, res.metrics));
  assert.ok(sectionText.includes('Bosta'), 'report section names the top opportunity');
  assert.ok(sectionText.includes('/approvals/customer0'), 'report section links the governed review surface');
  assert.ok(sectionText.toLowerCase().includes('loop'), 'report section describes the governed loop');
  assert.ok(!sectionText.includes('re_secretkey_test'), 'report text must not leak secrets');

  // NO MATERIAL CHANGE when nothing changed
  const res2 = await reportMod.generateAndSend(db, win, win + interval);
  assert.strictEqual(res2.metrics.customer0.materialChange, false, 'no material change on an unchanged window');
  const sectionText2 = customer0.renderCustomer0Text(await customer0.buildReportSection(db, res2.metrics));
  assert.ok(sectionText2.includes('NO MATERIAL CHANGE'), 'report states NO MATERIAL CHANGE instead of fabricating activity');

  // a new decision flips the fingerprint → next window is a material change
  const flip = await customer0.decide(db, { id: draft2.email.id, decision: 'approve', founder: founderArg });
  assert.ok(flip.error === 'already_decided', 'rejected draft cannot be approved later');
  const fresh = await ch.createDraft(r, {
    workspace_id: ws.id,
    to: 'hiring@pushbots.com',
    from: 'info@elmahrosa.org',
    subject: 'PushBots sales capacity',
    body: 'Hello PushBots,\n\nGoverned revenue workforce demo.\n\nElmahrosa',
    campaign: 'customer0:prospect_2'
  });
  await ch.requestApproval(r, ws.id, fresh.email.id, { reason: 'customer0 outreach' });
  const res3 = await reportMod.generateAndSend(db, win + interval, win + 2 * interval);
  assert.strictEqual(res3.metrics.customer0.materialChange, true, 'new draft is a material change');
  assert.strictEqual(res3.metrics.customer0.pendingApprovals, 1, 'pending-approval count surfaced in report metrics');

  const genAudits = (await r.audit.list(null, {})).filter(a => a.action_type === 'FOUNDER_REPORT_GENERATED');
  assert.strictEqual(genAudits.length, 3, 'three founder reports generated and audited');
  assert.ok(genAudits[0].details && genAudits[0].details.customer0, 'generation audit records the customer0 summary');

  // ------------------------------------------------------------------ latest report endpoint payload
  const latest = await customer0.latestReport(db);
  assert.ok(latest, 'latest report available');
  assert.ok(latest.report_id, 'latest report id');
  assert.ok(latest.subject.includes('Customer #0'), 'latest report subject');
  assert.ok(latest.metrics && latest.metrics.customer0, 'latest report carries customer0 metrics');

  console.log('✅ Customer #0: scorecard, seed, governance, decisions, expiry, authz, no-send, report — all passing');
}

main().catch(err => {
  console.error('❌ Customer #0 test failed:', err.message);
  process.exit(1);
});
