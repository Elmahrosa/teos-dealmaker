const assert = require('assert');
const crypto = require('crypto');

(async () => {
  const ENVS = [
    'DATABASE_URL', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'EMAIL_FROM',
    'FOUNDER_REPORT_EMAIL', 'FOUNDER_REPORT_TO',
    'RESEND_DOMAIN', 'RESEND_WEBHOOK_SECRET', 'OUTREACH_ENABLED',
    'OUTREACH_EMERGENCY_STOP', 'OUTREACH_REQUIRE_VERIFIED_DOMAIN',
    'OUTREACH_DAILY_LIMIT', 'OUTREACH_HOURLY_LIMIT',
    'PER_RECIPIENT_COOLDOWN_MINUTES', 'MAX_RETRIES', 'MAX_QUEUE_SIZE',
    'OUTREACH_POLL_MS', 'RESEND_TIMEOUT_MS', 'FOUNDER_ALERT_MIN_INTERVAL_MS'
  ];
  for (const k of ENVS) delete process.env[k];

  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };
  const eq = (a, b, label) => { assert.strictEqual(a, b, label); passed += 1; };

  console.log('\n=== Governed 24/7 Outbound Worker ===');

  const { createMemoryAdapter, createRepos } = require('../db');
  const { createWorker, SERVICE_STATES, JOB_STATES } = require('../services/outboundWorker');
  const { missionReport } = require('../services/missionReport');

  function jsonRes(status, body, headersObj) {
    const text = JSON.stringify(body);
    const headers = {
      get: (k) => {
        if (!headersObj) return null;
        const wanted = String(k).toLowerCase();
        for (const hk of Object.keys(headersObj)) {
          if (String(hk).toLowerCase() === wanted) return headersObj[hk];
        }
        return null;
      }
    };
    return {
      ok: status >= 200 && status < 300,
      status,
      headers,
      text: async () => text,
      json: async () => JSON.parse(text)
    };
  }

  function makeFakeFetch() {
    const calls = [];
    const queue = [];
    return {
      calls,
      push(status, body, headers) { queue.push(jsonRes(status, body, headers)); },
      pushAbort() {
        queue.push({ error: Object.assign(new Error('aborted'), { name: 'AbortError' }) });
      },
      pushNetworkError() { queue.push({ error: new TypeError('fetch failed') }); },
      impl: async (url, opts) => {
        calls.push({ url, opts });
        const next = queue.shift();
        if (next && next.error) throw next.error;
        if (!next) throw new TypeError('fetch failed');
        return next;
      }
    };
  }

  function setup(overrides, fetchMock) {
    const adapter = createMemoryAdapter();
    const repos = createRepos(adapter);
    const ws = repos.workspaces.create({
      name: 'Acme Out',
      slug: 'acme-out-' + Math.random().toString(36).slice(2, 8),
      plan: 'solo',
      status: 'active'
    });
    const worker = createWorker(Object.assign({ cooldownMinutes: 0 }, overrides, { fetch: fetchMock ? fetchMock.impl : null }));
    return { adapter, repos, ws, worker };
  }

  function baseJob(ws, overrides) {
    return Object.assign({
      workspace_id: ws.id,
      recipient: 'prospect@acme.com',
      subject: 'TEOS Sentinel Shield partnership',
      body: 'Hello — would you like to evaluate TEOS DealMaker?',
      approved_by: 'founder',
      approved_at: new Date().toISOString()
    }, overrides || {});
  }

  const key = 're_test_worker_key';
  const enabledOpts = { enabled: true, resendApiKey: key };
  const successRes = { id: 're_worker_1', to: 'prospect@acme.com' };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ===================== 1. fail-closed defaults =====================
  {
    const fake = makeFakeFetch();
    const { adapter, ws, worker } = setup({}, fake);
    const boot = await worker.recover(adapter);
    eq(boot.state, SERVICE_STATES.PAUSED, 'boot state is PAUSED by default');
    eq((await worker.effectiveState(adapter)), SERVICE_STATES.PAUSED, 'effective state PAUSED');

    const enq = await worker.enqueue(adapter, baseJob(ws));
    eq(enq.ok, false, 'enqueue refuses while not RUNNING');
    eq(enq.error, 'outreach_paused', 'enqueue reports outreach_paused');

    const r = await worker.resume(adapter, 'founder');
    eq(r.ok, false, 'resume refused without OUTREACH_ENABLED');
    eq(r.error, 'outreach_not_enabled', 'resume reports outreach_not_enabled');

    const tickRes = await worker.tick(adapter);
    eq(tickRes.state, SERVICE_STATES.PAUSED, 'tick reports PAUSED');
    eq(tickRes.sent, 0, 'tick never sends while paused');
    eq(fake.calls.length, 0, 'zero external calls in the default fail-closed configuration');
    eq(worker.health ? (await worker.health(adapter)).outbound_email : null, 'DISABLED', 'health reports outbound DISABLED');
  }

  // ===================== 2. crash / restart recovery =====================
  {
    const { adapter, worker } = setup(enabledOpts, makeFakeFetch());
    await worker.resume(adapter, 'founder');
    eq((await worker.effectiveState(adapter)), SERVICE_STATES.RUNNING, 'resumed to RUNNING');

    // simulate a process restart: a NEW worker sees DB RUNNING = unclean shutdown
    const restarted = createWorker(enabledOpts);
    const rec = await restarted.recover(adapter);
    eq(rec.state, SERVICE_STATES.DEGRADED, 'RUNNING at boot degrades to DEGRADED (crash detected)');
    const st = await restarted.effectiveState(adapter);
    eq(st, SERVICE_STATES.DEGRADED, 'effective state DEGRADED after crash');
    const tickRes = await restarted.tick(adapter);
    eq(tickRes.sent, 0, 'no sends while DEGRADED');
    const rs = await restarted.resume(adapter, 'founder');
    eq(rs.ok, true, 'explicit founder resume required after crash');
  }

  // clean pause survives restart
  {
    const { adapter, worker } = setup(enabledOpts, makeFakeFetch());
    await worker.resume(adapter, 'founder');
    await worker.pause(adapter, 'founder', 'scheduled quiet hours');
    const restarted = createWorker(enabledOpts);
    const rec = await restarted.recover(adapter);
    eq(rec.state, SERVICE_STATES.PAUSED, 'PAUSED persists across a clean restart');
  }

  // ===================== 3. missing RESEND_API_KEY =====================
  {
    const fake = makeFakeFetch();
    const { adapter, repos, ws, worker } = setup({ enabled: true }, fake);
    await worker.resume(adapter, 'founder');
    const enq = await worker.enqueue(adapter, baseJob(ws));
    ok(enq.ok, 'job accepted when no key (gate runs at send time)');
    await worker.tick(adapter);
    const job = repos.outboundJobs.get(enq.job.id);
    eq(job.status, JOB_STATES.BLOCKED, 'job BLOCKED without RESEND_API_KEY');
    ok(/not configured/.test(job.failure_reason), 'blocked reason mentions missing key');
    eq(fake.calls.length, 0, 'no external call without a key');
  }

  // ===================== 4. sender domain verification =====================
  {
    const fake = makeFakeFetch();
    const { adapter, ws, worker } = setup({ enabled: true, resendApiKey: key }, fake);
    await worker.resume(adapter, 'founder');
    const enq = await worker.enqueue(adapter, baseJob(ws, { from_email: 'sales@other.com' }));
    eq(enq.ok, false, 'unverified sender refused at enqueue');
    eq(enq.error, 'sender_not_verified', 'enqueue reports sender_not_verified');
    eq(fake.calls.length, 0, 'no external call for unverified sender');
  }

  // ===================== 5. approval required =====================
  {
    const fake = makeFakeFetch();
    const { adapter, ws, worker } = setup(enabledOpts, fake);
    await worker.resume(adapter, 'founder');
    const noApproval = baseJob(ws);
    delete noApproval.approved_by;
    delete noApproval.approved_at;
    const enq = await worker.enqueue(adapter, noApproval);
    eq(enq.error, 'approval_required', 'enqueue refuses without approval');
    eq(fake.calls.length, 0, 'no external call without approval');
  }

  // approval via an approval_requests row (decided/approved)
  {
    const fake = makeFakeFetch();
    const { adapter, repos, ws, worker } = setup(enabledOpts, fake);
    await worker.resume(adapter, 'founder');
    const appr = repos.approvals.create({ workspace_id: ws.id, plan_id: null, step_id: null, agent_type: 'outreach', reason: 'founder review' });
    repos.approvals.update(ws.id, appr.id, { status: 'approved', decided_at: new Date().toISOString(), decided_by: 1 });
    const enq = await worker.enqueue(adapter, baseJob(ws, { approval_id: appr.id }));
    ok(enq.ok, 'job accepted with an approved approval_id');
    const pending = repos.approvals.create({ workspace_id: ws.id, plan_id: null, step_id: null, agent_type: 'outreach', reason: 'awaiting review' });
    const notYet = await worker.enqueue(adapter, baseJob(ws, { recipient: 'two@acme.com', approval_id: pending.id }));
    eq(notYet.error, 'approval_required', 'pending approval is refused');
  }

  // ===================== 6. invalid recipient =====================
  {
    const fake = makeFakeFetch();
    const { adapter, ws, worker } = setup(enabledOpts, fake);
    await worker.resume(adapter, 'founder');
    const enq = await worker.enqueue(adapter, baseJob(ws, { recipient: 'not-an-email' }));
    eq(enq.error, 'invalid_recipient', 'enqueue refuses invalid recipient');
    eq(fake.calls.length, 0, 'no external call for invalid recipient');
  }

  // ===================== 7. pause stops the world =====================
  {
    const fake = makeFakeFetch();
    const { adapter, repos, ws, worker } = setup(enabledOpts, fake);
    await worker.resume(adapter, 'founder');
    const enq = await worker.enqueue(adapter, baseJob(ws));
    ok(enq.ok, 'job queued while running');
    await worker.pause(adapter, 'founder', 'hold on');
    eq((await worker.effectiveState(adapter)), SERVICE_STATES.PAUSED, 'state PAUSED');
    const again = await worker.enqueue(adapter, baseJob(ws, { recipient: 'more@acme.com' }));
    eq(again.error, 'outreach_paused', 'no new jobs while paused');
    const t = await worker.tick(adapter);
    eq(t.sent, 0, 'no sends while paused');
    const job = repos.outboundJobs.get(enq.job.id);
    eq(job.status, JOB_STATES.QUEUED, 'queued jobs are preserved across pause');
    eq(fake.calls.length, 0, 'zero external calls across pause');
  }

  // ===================== 8. emergency stop =====================
  {
    const fake = makeFakeFetch();
    fake.push(200, { id: 're_worker_x', to: 'x@acme.com' });
    fake.push(200, { id: 're_alert_1', to: 'founder@elmahrosa.org' });
    const { adapter, repos, ws, worker } = setup(enabledOpts, fake);
    await worker.resume(adapter, 'founder');
    const enq = await worker.enqueue(adapter, baseJob(ws));
    const enq2 = await worker.enqueue(adapter, baseJob(ws, { recipient: 'second@acme.com' }));
    ok(enq.ok && enq2.ok, 'two jobs queued');
    const stop = await worker.emergencyStop(adapter, 'founder', 'test emergency');
    eq(stop.ok, true, 'emergency stop ok');
    eq(stop.state, SERVICE_STATES.EMERGENCY_STOPPED, 'state EMERGENCY_STOPPED');
    eq(stop.cancelled, 2, 'both queued jobs cancelled');
    eq(process.env.OUTREACH_EMERGENCY_STOP, 'true', 'process flag set (overrides everything)');
    const j1 = repos.outboundJobs.get(enq.job.id);
    const j2 = repos.outboundJobs.get(enq2.job.id);
    eq(j1.status, JOB_STATES.CANCELLED, 'job 1 CANCELLED');
    eq(j2.status, JOB_STATES.CANCELLED, 'job 2 CANCELLED');
    const blocked = await worker.enqueue(adapter, baseJob(ws, { recipient: 'three@acme.com' }));
    eq(blocked.error, 'emergency_stopped', 'enqueue refused after emergency stop');
    const t = await worker.tick(adapter);
    eq(t.sent, 0, 'no sends after emergency stop');
    const rs = await worker.resume(adapter, 'founder');
    eq(rs.error, 'emergency_stop_env_active', 'resume refused while emergency-stop env is active');
    delete process.env.OUTREACH_EMERGENCY_STOP;
    const rs2 = await worker.resume(adapter, 'founder');
    eq(rs2.ok, true, 'resume allowed after clearing the emergency-stop env');
  }

  // ===================== 9. idempotent enqueue =====================
  {
    const fake = makeFakeFetch();
    const { adapter, repos, ws, worker } = setup(enabledOpts, fake);
    await worker.resume(adapter, 'founder');
    const a = await worker.enqueue(adapter, baseJob(ws));
    const b = await worker.enqueue(adapter, baseJob(ws));
    eq(b.duplicate, true, 'duplicate enqueue flagged');
    eq(b.job.id, a.job.id, 'duplicate returns the same job');
    eq(repos.outboundJobs.list(ws.id, {}).length, 1, 'only one row persisted');
  }

  // ===================== 10. successful governed send =====================
  {
    const fake = makeFakeFetch();
    fake.push(200, successRes, { 'Message-ID': '<mworker1@resend.com>' });
    fake.push(200, { id: 're_alert_ok', to: 'founder@elmahrosa.org' });
    const { adapter, repos, ws, worker } = setup(enabledOpts, fake);
    await worker.resume(adapter, 'founder');
    const enq = await worker.enqueue(adapter, baseJob(ws));
    ok(enq.ok, 'job accepted');
    const t = await worker.tick(adapter);
    eq(t.sent, 1, 'one job sent');
    eq(t.state, SERVICE_STATES.RUNNING, 'still RUNNING after send');
    const job = repos.outboundJobs.get(enq.job.id);
    eq(job.status, JOB_STATES.SENT, 'job SENT');
    eq(job.provider, 'resend', 'provider is resend');
    eq(job.provider_message_id, 're_worker_1', 'provider message id persisted');
    eq(job.message_id_header, '<mworker1@resend.com>', 'message-id header persisted');
    ok(job.sent_at, 'sent_at recorded');
    const svc = repos.outboundService.get();
    ok(svc.last_successful_job_at, 'last_successful_job_at recorded');
    eq(fake.calls[0].url, 'https://api.resend.com/emails', 'first external call is the Resend send endpoint');
    const toPayload = JSON.parse(fake.calls[0].opts.body);
    eq(toPayload.from, 'info@elmahrosa.org', 'from defaults to info@elmahrosa.org');
    eq(Array.isArray(toPayload.to) ? toPayload.to[0] : toPayload.to, 'prospect@acme.com', 'to matches recipient');
    const audit = repos.audit.list(ws.id, {});
    ok(audit.some(e => e.action_type === 'EMAIL_JOB_SENT'), 'EMAIL_JOB_SENT audited');
    await sleep(30);
    const alerts = adapter.find('audit_trail', {});
    ok(alerts.some(e => e.action_type === 'FOUNDER_ALERT_SENT'), 'founder alert sent and audited');
  }

  // ===================== 11. provider failure → retry → fail =====================
  {
    const fake = makeFakeFetch();
    fake.push(422, { message: 'invalid sender' });
    const { adapter, repos, ws, worker } = setup({ enabled: true, resendApiKey: key, maxRetries: 1 }, fake);
    await worker.resume(adapter, 'founder');
    const enq = await worker.enqueue(adapter, baseJob(ws));
    await worker.tick(adapter);
    let job = repos.outboundJobs.get(enq.job.id);
    eq(job.status, JOB_STATES.QUEUED, 'provider failure retries (still QUEUED)');
    eq(job.retry_count, 1, 'retry_count incremented');
    ok(String(job.next_attempt_at) > new Date().toISOString(), 'next attempt pushed into the future (backoff)');
    // force the retry to be due
    repos.outboundJobs.update(job.id, { next_attempt_at: new Date(0).toISOString() });
    fake.push(422, { message: 'invalid sender again' });
    fake.push(200, { id: 're_alert_3', to: 'founder@elmahrosa.org' });
    await worker.tick(adapter);
    job = repos.outboundJobs.get(job.id);
    eq(job.status, JOB_STATES.SEND_FAILED, 'terminal SEND_FAILED after retries exhausted');
    const jobSends = fake.calls.filter(c => c.url === 'https://api.resend.com/emails' && c.opts.body && JSON.parse(c.opts.body).to && JSON.parse(c.opts.body).to[0] === 'prospect@acme.com');
    eq(jobSends.length, 2, 'prospect send attempted exactly twice (initial + retry)');
    await sleep(30);
  }

  // ===================== 12. timeout → SEND_UNKNOWN, never auto-retried =====================
  {
    const fake = makeFakeFetch();
    fake.pushAbort();
    fake.pushAbort();
    const { adapter, repos, ws, worker } = setup(enabledOpts, fake);
    await worker.resume(adapter, 'founder');
    const enq = await worker.enqueue(adapter, baseJob(ws));
    await worker.tick(adapter);
    let job = repos.outboundJobs.get(enq.job.id);
    eq(job.status, JOB_STATES.SEND_UNKNOWN, 'timeout → SEND_UNKNOWN');
    ok(/verify required/.test(job.failure_reason), 'unknown outcome demands verification');
    await worker.tick(adapter);
    job = repos.outboundJobs.get(job.id);
    eq(job.status, JOB_STATES.SEND_UNKNOWN, 'unknown outcome is NEVER auto-retried');
    const jobSends = fake.calls.filter(c => c.url === 'https://api.resend.com/emails' && c.opts.body && JSON.parse(c.opts.body).to && JSON.parse(c.opts.body).to[0] === 'prospect@acme.com');
    eq(jobSends.length, 1, 'prospect send attempted exactly once (no auto retry)');
  }

  // ===================== 13. missing provider id → SEND_UNKNOWN =====================
  {
    const fake = makeFakeFetch();
    fake.push(200, { to: 'prospect@acme.com' });
    fake.pushAbort();
    const { adapter, repos, ws, worker } = setup(enabledOpts, fake);
    await worker.resume(adapter, 'founder');
    const enq = await worker.enqueue(adapter, baseJob(ws));
    await worker.tick(adapter);
    const job = repos.outboundJobs.get(enq.job.id);
    eq(job.status, JOB_STATES.SEND_UNKNOWN, '2xx without a verifiable provider id → SEND_UNKNOWN');
  }

  // ===================== 14. daily + hourly limits =====================
  {
    const fake = makeFakeFetch();
    fake.push(200, { id: 're_d1', to: 'a@acme.com' });
    fake.push(200, { id: 're_alert_d', to: 'founder@elmahrosa.org' });
    const { adapter, repos, ws, worker } = setup({ enabled: true, resendApiKey: key, dailyLimit: 1, hourlyLimit: 5 }, fake);
    await worker.resume(adapter, 'founder');
    await worker.enqueue(adapter, baseJob(ws, { recipient: 'a@acme.com' }));
    await worker.tick(adapter);
    const b = await worker.enqueue(adapter, baseJob(ws, { recipient: 'b@acme.com' }));
    eq(b.error, 'daily_limit_reached', 'daily limit blocks the next job');
    eq(repos.outboundService.get().state, SERVICE_STATES.PAUSED, 'daily limit auto-pauses the service');
    const c = await worker.enqueue(adapter, baseJob(ws, { recipient: 'c@acme.com' }));
    eq(c.error, 'outreach_paused', 'paused service refuses further enqueues');
  }
  {
    const fake = makeFakeFetch();
    fake.push(200, { id: 're_h1', to: 'x@acme.com' });
    fake.push(200, { id: 're_alert_h', to: 'founder@elmahrosa.org' });
    const { adapter, repos, ws, worker } = setup({ enabled: true, resendApiKey: key, dailyLimit: 20, hourlyLimit: 1 }, fake);
    await worker.resume(adapter, 'founder');
    await worker.enqueue(adapter, baseJob(ws, { recipient: 'x@acme.com' }));
    await worker.tick(adapter);
    const b = await worker.enqueue(adapter, baseJob(ws, { recipient: 'y@acme.com' }));
    eq(b.error, 'hourly_limit_reached', 'hourly limit blocks the next job');
    eq(repos.outboundService.get().state, SERVICE_STATES.PAUSED, 'hourly limit auto-pauses the service');
  }

  // ===================== 15. per-recipient cooldown =====================
  {
    const fake = makeFakeFetch();
    fake.push(200, { id: 're_c1', to: 'p@acme.com' });
    fake.push(200, { id: 're_alert_c', to: 'founder@elmahrosa.org' });
    const { adapter, repos, ws, worker } = setup({ enabled: true, resendApiKey: key, cooldownMinutes: 1440 }, fake);
    await worker.resume(adapter, 'founder');
    await worker.enqueue(adapter, baseJob(ws, { recipient: 'p@acme.com' }));
    const second = await worker.enqueue(adapter, baseJob(ws, { recipient: 'p@acme.com', subject: 'Second outreach' }));
    await worker.tick(adapter);
    const job2 = repos.outboundJobs.get(second.job.id);
    eq(job2.status, JOB_STATES.QUEUED, 'second job to the same recipient stays QUEUED');
    ok(String(job2.next_attempt_at) > new Date().toISOString(), 'second job deferred by cooldown');
    const jobSends = fake.calls.filter(c => c.url === 'https://api.resend.com/emails' && c.opts.body && JSON.parse(c.opts.body).to && JSON.parse(c.opts.body).to[0] === 'p@acme.com');
    eq(jobSends.length, 1, 'only the first job was sent');
  }

  // ===================== 16. stale lease → SEND_UNKNOWN =====================
  {
    const fake = makeFakeFetch();
    const { adapter, repos, ws, worker } = setup(enabledOpts, fake);
    await worker.resume(adapter, 'founder');
    const enq = await worker.enqueue(adapter, baseJob(ws));
    repos.outboundJobs.update(enq.job.id, { status: JOB_STATES.PROCESSING, lease_until: new Date(Date.now() - 1000).toISOString() });
    await worker.tick(adapter);
    const job = repos.outboundJobs.get(enq.job.id);
    eq(job.status, JOB_STATES.SEND_UNKNOWN, 'expired lease → SEND_UNKNOWN (verify required, never double-send)');
    eq(fake.calls.length, 0, 'no external call on stale reclaim');
  }

  // ===================== 17. webhook signature verification =====================
  const secret = 'whsec_dGVzdHdlYmhvb2tzZWNyZXQ=';
  function signWebhook(body, overrides) {
    const o = overrides || {};
    const id = o.id || 'msg_123';
    const ts = String(o.ts != null ? o.ts : Math.floor(Date.now() / 1000));
    const key = Buffer.from(secret.replace(/^whsec_/i, ''), 'base64');
    const payload = `${id}.${ts}.${body}`;
    const sig = crypto.createHmac('sha256', key).update(payload).digest('base64');
    return {
      'svix-id': id,
      'svix-timestamp': ts,
      'svix-signature': `v1,${sig}`,
      'content-type': 'application/json'
    };
  }
  {
    const { worker } = setup({ webhookSecret: secret }, null);
    const body = JSON.stringify({ type: 'email.sent', data: { email_id: 're_webhook_1' } });
    eq(worker.verifyWebhookSignature(body, signWebhook(body)).ok, true, 'valid svix signature verifies');
    eq(worker.verifyWebhookSignature(body, signWebhook(body, { ts: Math.floor(Date.now() / 1000) - 600 })).error, 'stale_timestamp', 'stale timestamp rejected');
    const tampered = signWebhook(body);
    tampered['svix-signature'] = 'v1,AAAA';
    eq(worker.verifyWebhookSignature(body, tampered).error, 'invalid_signature', 'tampered signature rejected');
    const noSecretWorker = createWorker({});
    eq(noSecretWorker.verifyWebhookSignature(body, signWebhook(body)).error, 'webhook_not_configured', 'fail-closed without a configured secret');
  }

  // ===================== 18. webhook replay is idempotent =====================
  {
    const { adapter, repos, worker } = setup({ webhookSecret: secret }, null);
    const event = { id: 'evt_dup_1', type: 'email.sent', data: { email_id: 're_dup_1', to: ['prospect@acme.com'] } };
    const first = await worker.handleWebhook(adapter, event);
    eq(first.duplicate, false, 'first webhook processed');
    const second = await worker.handleWebhook(adapter, event);
    eq(second.duplicate, true, 'replayed webhook is a no-op');
    eq(repos.resendEvents.getByEventId('evt_dup_1') !== null, true, 'event stored once');
  }

  // ===================== 19. delivered webhook → PROVIDER_CONFIRMED =====================
  {
    const fake = makeFakeFetch();
    fake.push(200, { id: 're_del_1', to: 'd@acme.com' });
    fake.push(200, { id: 're_alert_del', to: 'founder@elmahrosa.org' });
    const { adapter, repos, ws, worker } = setup({ enabled: true, resendApiKey: key, webhookSecret: secret }, fake);
    await worker.resume(adapter, 'founder');
    const enq = await worker.enqueue(adapter, baseJob(ws, { recipient: 'd@acme.com' }));
    await worker.tick(adapter);
    const job = repos.outboundJobs.get(enq.job.id);
    eq(job.status, JOB_STATES.SENT, 'job SENT before webhook');
    const res = await worker.handleWebhook(adapter, { id: 'evt_del_1', type: 'email.delivered', data: { email_id: 're_del_1' } });
    eq(res.job_id, job.id, 'webhook matched the job by provider id');
    const after = repos.outboundJobs.get(job.id);
    eq(after.status, JOB_STATES.PROVIDER_CONFIRMED, 'delivery webhook confirms the job');
    eq(after.send_status, 'delivered', 'delivery send_status recorded');
  }

  // ===================== 20. bounce → suppression + queued cancel =====================
  {
    const fake = makeFakeFetch();
    fake.push(200, { id: 're_b_1', to: 'bounce@acme.com' });
    fake.push(200, { id: 're_alert_b', to: 'founder@elmahrosa.org' });
    const { adapter, repos, ws, worker } = setup({ enabled: true, resendApiKey: key, webhookSecret: secret }, fake);
    await worker.resume(adapter, 'founder');
    const sent = await worker.enqueue(adapter, baseJob(ws, { recipient: 'bounce@acme.com' }));
    const queued = await worker.enqueue(adapter, baseJob(ws, { recipient: 'bounce@acme.com', subject: 'Follow-up' }));
    await worker.tick(adapter);
    const res = await worker.handleWebhook(adapter, {
      id: 'evt_b_1',
      type: 'email.bounced',
      data: { email_id: 're_b_1', to: ['bounce@acme.com'] }
    });
    eq(res.suppress, 'bounce', 'bounce reports suppression');
    const sentJob = repos.outboundJobs.get(sent.job.id);
    eq(sentJob.status, JOB_STATES.SEND_FAILED, 'bounced job → SEND_FAILED');
    eq(sentJob.send_status, 'bounced', 'bounce send_status recorded');
    const queuedJob = repos.outboundJobs.get(queued.job.id);
    eq(queuedJob.status, JOB_STATES.SUPPRESSED, 'queued job to bounced address → SUPPRESSED');
    eq(await repos.emailSuppressions.isSuppressed('bounce@acme.com'), true, 'address suppressed');
    const blocked = await worker.enqueue(adapter, baseJob(ws, { recipient: 'bounce@acme.com' }));
    eq(blocked.error, 'suppressed', 'future outreach to a suppressed address is refused');
    // gate also blocks at send time
    const g = await worker.gateSend(adapter, { recipient: 'bounce@acme.com', from_email: 'info@elmahrosa.org', approved_at: new Date().toISOString(), approved_by: 'founder', idempotency_key: 'zzz', }, SERVICE_STATES.RUNNING);
    eq(g.reason, 'suppressed', 'gateSend blocks suppressed addresses');
  }

  // ===================== 21. complaint → suppression =====================
  {
    const fake = makeFakeFetch();
    fake.push(200, { id: 're_cmp_1', to: 'cmp@acme.com' });
    fake.push(200, { id: 're_alert_cmp', to: 'founder@elmahrosa.org' });
    const { adapter, repos, ws, worker } = setup({ enabled: true, resendApiKey: key, webhookSecret: secret }, fake);
    await worker.resume(adapter, 'founder');
    const sent = await worker.enqueue(adapter, baseJob(ws, { recipient: 'cmp@acme.com' }));
    await worker.tick(adapter);
    const res = await worker.handleWebhook(adapter, { id: 'evt_cmp_1', type: 'email.complained', data: { email_id: 're_cmp_1', to: ['cmp@acme.com'] } });
    eq(res.suppress, 'complaint', 'complaint reports suppression');
    eq(await repos.emailSuppressions.isSuppressed('cmp@acme.com'), true, 'complained address suppressed');
    const job = repos.outboundJobs.get(sent.job.id);
    eq(job.status, JOB_STATES.SEND_FAILED, 'complained job → SEND_FAILED');
  }

  // ===================== 22. health never leaks secrets =====================
  {
    const { adapter, worker } = setup(enabledOpts, null);
    const h = await worker.health(adapter);
    eq(h.ok, true, 'health ok');
    eq(h.provider, 'Resend', 'health reports provider');
    eq(h.resend, 'HEALTHY', 'resend HEALTHY when key present');
    ok(!JSON.stringify(h).includes('re_test_worker_key'), 'health does not leak the API key');
    ok(h.webhookSecret === undefined, 'health never exposes the webhook secret');
    eq(h.emergency_stop_env, false, 'health reports emergency-stop env flag');
  }

  // ===================== 23. reportActivity =====================
  {
    const fake = makeFakeFetch();
    fake.push(200, { id: 're_r_1', to: 'r@acme.com' });
    fake.push(200, { id: 're_alert_r', to: 'founder@elmahrosa.org' });
    const { adapter, ws, worker } = setup(enabledOpts, fake);
    await worker.resume(adapter, 'founder');
    await worker.enqueue(adapter, baseJob(ws, { recipient: 'r@acme.com' }));
    await worker.tick(adapter);
    const rep = await worker.reportActivity(adapter, ws.id);
    eq(rep.total_jobs, 1, 'report counts total jobs');
    eq(rep.sent, 1, 'report counts sent');
    eq(rep.sent_today, 1, 'report counts today sends');
    eq(rep.last_sent.recipient, 'r@acme.com', 'report includes last sent recipient');
    eq(rep.last_sent.provider_message_id, 're_r_1', 'report includes provider id (evidence, not claims)');
    eq(rep.suppression_count, 0, 'report counts suppressions');
  }

  // ===================== 24. mission report outbound section =====================
  {
    const fake = makeFakeFetch();
    fake.push(200, { id: 're_m_1', to: 'm@acme.com' });
    fake.push(200, { id: 're_alert_m', to: 'founder@elmahrosa.org' });
    const { adapter, repos, ws, worker } = setup(enabledOpts, fake);
    await worker.resume(adapter, 'founder');
    const plan = repos.plans.create({ workspace_id: ws.id, title: 'Mission', goal: 'Close a deal', status: 'active' });
    repos.planSteps.create({ workspace_id: ws.id, plan_id: plan.id, step_key: 'discover', agent_type: 'discovery', task: 'Qualify', status: 'completed', completed_at: new Date().toISOString() });
    await worker.enqueue(adapter, baseJob(ws, { recipient: 'm@acme.com', mission_id: plan.id }));
    await worker.tick(adapter);
    const rep = await missionReport(adapter, ws.id, plan.id);
    ok(rep && rep.outbound, 'mission report includes an outbound section');
    eq(rep.outbound.sent, 1, 'mission report reflects worker sends');
    eq(rep.outbound.last_sent.provider_message_id, 're_m_1', 'mission report shows provider evidence');
    eq(rep.outbound.last_sent.recipient, undefined, 'mission report strips the recipient from last_sent');
    ok(JSON.stringify(rep.outbound).indexOf('m@acme.com') === -1, 'mission report outbound block never leaks a recipient address');
  }

  // ===================== 25. duplicate provider id protection =====================
  {
    const fake = makeFakeFetch();
    fake.push(200, { id: 're_dup', to: 'dup@acme.com' });
    fake.push(200, { id: 're_alert_dup', to: 'founder@elmahrosa.org' });
    const { adapter, ws, worker } = setup(enabledOpts, fake);
    await worker.resume(adapter, 'founder');
    await worker.enqueue(adapter, baseJob(ws, { recipient: 'dup@acme.com' }));
    await worker.tick(adapter);
    // force a second job with the SAME idempotency key (simulating a stale retry path)
    const dup = await worker.enqueue(adapter, baseJob(ws, { recipient: 'dup@acme.com' }));
    eq(dup.duplicate, true, 'same governed action cannot be enqueued twice');
    eq(dup.job.status, JOB_STATES.SENT, 'duplicate references the original sent job');
  }

  // ===================== 26. founder ops report fails closed =====================
  {
    const auditLogger = require('../utils/auditLogger');
    const before = auditLogger.readVault().filter(e => e.action === 'FOUNDER_OPS_REPORT').length;
    const { adapter, worker } = setup({}, null);
    const res = await worker.sendFounderOpsReport(adapter, {});
    eq(res.ok, false, 'ops report fails closed without a Resend key');
    eq(res.reason, 'resend_not_configured', 'ops report reports resend_not_configured');
    const entries = auditLogger.readVault().filter(e => e.action === 'FOUNDER_OPS_REPORT');
    eq(entries.length, before + 1, 'ops report denial is audited');
    eq(entries[entries.length - 1].status, 'denied', 'ops report denial audited as denied');
    eq(entries[entries.length - 1].details.reason, 'resend_not_configured', 'denial reason recorded');
  }

  // ===================== 27. founder ops report sends a sanitized email =====================
  {
    const auditLogger = require('../utils/auditLogger');
    const before = auditLogger.readVault().filter(e => e.action === 'FOUNDER_OPS_REPORT').length;
    const fake = makeFakeFetch();
    fake.push(200, { id: 're_ops_job', to: 'o@acme.com' });
    fake.push(200, { id: 're_ops_alert', to: 'founder@elmahrosa.org' });
    fake.push(200, { id: 're_ops_1', to: 'teosegy@gmail.com' });
    const { adapter, ws, worker } = setup(enabledOpts, fake);
    await worker.resume(adapter, 'founder');
    await worker.enqueue(adapter, baseJob(ws, { recipient: 'o@acme.com' }));
    await worker.tick(adapter);
    const res = await worker.sendFounderOpsReport(adapter, {});
    eq(res.ok, true, 'ops report sends when a key is configured');
    eq(res.provider_message_id, 're_ops_1', 'ops report provider id returned');
    eq(res.summary.sent, 1, 'ops report counts sent jobs');
    const opsCall = fake.calls[2];
    ok(opsCall && opsCall.opts, 'ops report made a send call');
    const body = JSON.parse(opsCall.opts.body);
    eq(body.to[0], 'teosegy@gmail.com', 'ops report is addressed to the founder destination only');
    eq(body.from, 'info@elmahrosa.org', 'ops report uses the canonical sender (EMAIL_FROM default)');
    ok(String(body.text).indexOf('o@acme.com') === -1, 'ops report body never contains a prospect address');
    ok(String(body.text).indexOf('re_test_worker_key') === -1, 'ops report body never leaks the API key');
    const entries = auditLogger.readVault().filter(e => e.action === 'FOUNDER_OPS_REPORT');
    eq(entries.length, before + 1, 'ops report success is audited');
    eq(entries[entries.length - 1].status, 'success', 'ops report success audited as success');
  }

  // ===================== 28. queue view is sanitized =====================
  {
    const { adapter, ws, worker } = setup(enabledOpts, makeFakeFetch());
    await worker.resume(adapter, 'founder');
    await worker.enqueue(adapter, baseJob(ws, { recipient: 'o@acme.com' }));
    const q = await worker.queue(adapter, 50);
    ok(q && q.ok, 'queue view returns a valid payload');
    ok(q.counts && typeof q.counts.QUEUED === 'number', 'queue view returns counts by status');
    eq(q.counts.QUEUED >= 1, true, 'queue counts include the queued job');
    ok(Array.isArray(q.recent), 'queue view returns a recent list');
    ok(q.recent.every(j => !String(j.recipient_domain || '').includes('@')), 'queue view exposes domains, never full addresses');
    ok(q.recent.every(j => !('body' in j) && !('subject' in j)), 'queue view never exposes bodies or subjects');
  }

  console.log(`\n✓ governed outbound worker (${passed} assertions passed)`);
  console.log('RESULT: PASS');
  process.exit(0);
})().catch((err) => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});

