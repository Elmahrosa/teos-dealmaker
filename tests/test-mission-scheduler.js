// tests/test-mission-scheduler.js
// Mission scheduler opt-in governance: automatic outreach approval is
// strictly opt-in (AUTO_OUTREACH_ENABLED=true), the autonomous scheduler is
// opt-in (MISSION_SCHEDULER_ENABLED=true), and dispatch requires an explicit
// opt-in PLUS a RUNNING outbound worker. Missing/invalid config values deny;
// a founder emergency stop halts the pipeline; duplicate ticks never
// double-dispatch; approved email is never re-processed.
'use strict';

const assert = require('assert');

process.env.TEOS_FOUNDER_TELEGRAM_ID = '7770003';
for (const k of [
  'MISSION_SCHEDULER_ENABLED', 'AUTO_OUTREACH_ENABLED', 'FOLLOW_UP_ENABLED',
  'PROSPECT_DISCOVERY_ENABLED', 'PIPELINE_HEALTH_ENABLED',
  'MISSION_SCHEDULER_INTERVAL_MS', 'OUTREACH_ENABLED', 'RESEND_API_KEY',
  'OUTREACH_EMERGENCY_STOP', 'EMAIL_FROM', 'RESEND_DOMAIN', 'RESEND_WEBHOOK_SECRET'
]) delete process.env[k];

// The outbound worker's notifyFounder path uses fetch for provider calls;
// stub it so resume / emergencyStop never touch the network.
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

(async () => {
  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };
  const eq = (a, b, label) => { assert.strictEqual(a, b, label); passed += 1; };

  const dbMod = require('../db');
  const adapter = dbMod.createMemoryAdapter();
  const r = dbMod.createRepos(adapter);
  const db = { adapter, pg: null, repos: r };
  const scheduler = require('../services/missionScheduler');
  const customer0 = require('../services/customer0');
  const outbound = require('../services/outboundWorker');
  const emergency = require('../config/emergency');

  console.log('\n=== Mission scheduler opt-in governance ===');

  // ---- 1. opt-in defaults (missing config must never enable automation)
  const dflt = scheduler.getConfig();
  eq(dflt.enabled, false, 'autonomous scheduler disabled by default (opt-in)');
  eq(dflt.autoOutreachEnabled, false, 'auto-outreach approval disabled by default (opt-in)');

  // ---- 2. only an exact "true" enables; missing/malformed values deny
  const table = [
    ['false', false], ['TRUE', false], ['1', false], ['yes', false],
    ['on', false], ['', false], [undefined, false], ['true', true]
  ];
  for (const [value, expected] of table) {
    if (value === undefined) {
      delete process.env.MISSION_SCHEDULER_ENABLED;
      delete process.env.AUTO_OUTREACH_ENABLED;
    } else {
      process.env.MISSION_SCHEDULER_ENABLED = value;
      process.env.AUTO_OUTREACH_ENABLED = value;
    }
    const c = scheduler.getConfig();
    eq(c.enabled, expected, `MISSION_SCHEDULER_ENABLED=${value === undefined ? '<unset>' : JSON.stringify(value)} => ${expected}`);
    eq(c.autoOutreachEnabled, expected, `AUTO_OUTREACH_ENABLED=${value === undefined ? '<unset>' : JSON.stringify(value)} => ${expected}`);
  }
  delete process.env.MISSION_SCHEDULER_ENABLED;
  delete process.env.AUTO_OUTREACH_ENABLED;

  const started = scheduler.start(adapter);
  eq(started.ok, false, 'scheduler refuses to start while implicitly disabled');
  eq(started.reason, 'disabled', 'start reports disabled');

  // ---- 3. seed the founder workspace and one governed pending draft
  await customer0.seed(db, {});
  const ws = await adapter.findOne('workspaces', { slug: 'workspace_founder' });
  const pendingBefore = await r.outboundEmails.list(ws.id, { status: 'PENDING_APPROVAL' });
  ok(pendingBefore.length >= 1, 'seed produced at least one pending outreach draft');
  const seededId = pendingBefore[0].id;
  const countJobs = async () => (await r.outboundJobs.list(ws.id, {})).length;

  // ---- 4. missing configuration -> auto-outreach never touches dispatch
  const skipped = await scheduler.runAutoOutreach(adapter, scheduler.getConfig());
  eq(skipped.status, 'skipped', 'auto-outreach skipped without explicit opt-in');
  eq(skipped.reason, 'auto_outreach_not_enabled', 'skip triggered by the opt-in gate');
  const untouched = await r.outboundEmails.get(ws.id, seededId);
  ok(!untouched.approved_by, 'no approver stamped without opt-in');
  eq(await countJobs(), 0, 'no dispatch occurred without opt-in');

  // ---- 5. explicit opt-in + a RUNNING worker -> approval AND dispatch
  process.env.OUTREACH_ENABLED = 'true';
  process.env.RESEND_API_KEY = 're_test_scheduler';
  const resume = await outbound.resume(adapter, 'founder');
  eq(resume.ok, true, 'explicit founder resume makes the worker RUNNING');
  eq((await outbound.effectiveState(adapter)), 'RUNNING', 'effective worker state RUNNING');

  process.env.MISSION_SCHEDULER_ENABLED = 'true';
  process.env.AUTO_OUTREACH_ENABLED = 'true';
  const live = await scheduler.runAutoOutreach(adapter, scheduler.getConfig());
  eq(live.status, 'completed', 'explicit opt-in -> auto-outreach completes');
  eq(live.approved, pendingBefore.length, 'every pending draft got approved');
  eq(live.approved, await countJobs(), 'approvals exactly match queued dispatch jobs');
  const stamped = await r.outboundEmails.get(ws.id, seededId);
  ok(stamped.approved_by, 'approver recorded on the email');

  // ---- 6. duplicate tick never double-dispatches
  const dup = await scheduler.runAutoOutreach(adapter, scheduler.getConfig());
  eq(dup.status, 'completed', 'second tick still completes cleanly');
  eq(dup.approved, 0, 'second tick approves nothing (already decided)');
  eq(await countJobs(), pendingBefore.length, 'job count unchanged after duplicate tick');

  // ---- 7. malformed/disabled config values never dispatch
  const ch = customer0._channel();
  for (const bad of ['TRUE', '1', 'yes', 'false', '']) {
    process.env.AUTO_OUTREACH_ENABLED = bad;
    const before = await countJobs();
    const d = await ch.createDraft(r, {
      workspace_id: ws.id,
      to: `prospect-invalid-${bad || 'empty'}@acme.test`,
      from: 'info@elmahrosa.org',
      subject: 'Invalid-config draft',
      body: 'body',
      campaign: 'customer0:prospect_invalid'
    });
    await ch.requestApproval(r, ws.id, d.email.id, { reason: 'invalid-config test' });
    const res = await scheduler.runAutoOutreach(adapter, scheduler.getConfig());
    eq(res.status, 'skipped', `AUTO_OUTREACH_ENABLED='${bad}' => skipped`);
    eq(res.reason, 'auto_outreach_not_enabled', `AUTO_OUTREACH_ENABLED='${bad}' => opt-in gate hit`);
    const stored = await r.outboundEmails.get(ws.id, d.email.id);
    ok(!stored.approved_by, `AUTO_OUTREACH_ENABLED='${bad}' => draft untouched`);
    eq(await countJobs(), before, `AUTO_OUTREACH_ENABLED='${bad}' => no new dispatch`);
  }

  // ---- 8. founder emergency stop halts the pipeline even when opt-in is on
  process.env.AUTO_OUTREACH_ENABLED = 'true';
  const jobsBeforeEmergency = await countJobs();
  emergency.setEmergencyStop(true);
  try {
    const d = await ch.createDraft(r, {
      workspace_id: ws.id,
      to: 'prospect-emergency@acme.test',
      from: 'info@elmahrosa.org',
      subject: 'Emergency draft',
      body: 'body',
      campaign: 'customer0:prospect_emergency'
    });
    await ch.requestApproval(r, ws.id, d.email.id, { reason: 'emergency test' });
    const res = await scheduler.runAutoOutreach(adapter, scheduler.getConfig());
    eq(res.status, 'skipped', 'emergency stop skips auto-outreach');
    eq(res.reason, 'emergency_stopped', 'emergency stop is the skip reason');
    const stored = await r.outboundEmails.get(ws.id, d.email.id);
    ok(!stored.approved_by, 'no approval stamped while emergency is engaged');
    eq(await countJobs(), jobsBeforeEmergency, 'no dispatch while emergency is engaged');
  } finally {
    emergency.setEmergencyStop(false);
  }

  // ---- 9. worker-level emergency also blocks dispatch of approved items
  const jobsBeforeWorkerStop = await countJobs();
  const workerStop = await outbound.emergencyStop(adapter, 'founder', 'phase2 test');
  eq(workerStop.ok, true, 'worker entered emergency stop');
  try {
    const res = await scheduler.runAutoOutreach(adapter, scheduler.getConfig());
    eq(res.status, 'completed', 'opt-in tick still completes under worker stop');
    eq(await countJobs(), jobsBeforeWorkerStop, 'dispatch is blocked while the worker is emergency-stopped');
  } finally {
    delete process.env.OUTREACH_EMERGENCY_STOP;
  }

  // ---- 10. already-approved email is never re-dispatched
  const resume2 = await outbound.resume(adapter, 'founder');
  eq(resume2.ok, true, 'worker resumes after the emergency stop is cleared');
  const d = await ch.createDraft(r, {
    workspace_id: ws.id,
    to: 'prospect-approved@acme.test',
    from: 'info@elmahrosa.org',
    subject: 'Manually approved draft',
    body: 'body',
    campaign: 'customer0:prospect_approved'
  });
  await ch.requestApproval(r, ws.id, d.email.id, { reason: 'approved-email test' });
  const dec = await customer0.decide(db, {
    id: d.email.id,
    decision: 'approve',
    founder: { id: 'founder-user', email: 'founder@teos.test' }
  });
  eq(dec.ok, true, 'explicit founder approval accepted');
  const jobsAfterApprove = await countJobs();
  const idle = await scheduler.runAutoOutreach(adapter, scheduler.getConfig());
  eq(idle.status, 'completed', 'tick completes over the approved-but-unsent email');
  eq(idle.approved, 0, 'approved email is never re-approved by the tick');
  eq(await countJobs(), jobsAfterApprove, 'approved email is not double-dispatched');

  // ---- cleanup
  for (const k of ['MISSION_SCHEDULER_ENABLED', 'AUTO_OUTREACH_ENABLED', 'OUTREACH_ENABLED', 'RESEND_API_KEY']) delete process.env[k];

  console.log(`✓ mission scheduler opt-in governance (${passed} assertions passed)`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
