// Governed 24/7 outbound worker.
//
// Persistent queue + job model. The worker survives process restarts: every
// job lives in PostgreSQL and is claimed with an expiry lease, so a crash can
// never lose a job or silently double-send.
//
// Fail-closed by design:
//   - No send without: valid recipient, verified sender domain, approved
//     message, founder/authorized approval, policy PASS, no active suppression,
//     no duplicate for the same governed action, service state RUNNING, and a
//     configured RESEND_API_KEY.
//   - SENT is recorded only when Resend returns a successful response with a
//     verifiable provider message id. Timeouts and unknown outcomes become
//     SEND_UNKNOWN (VERIFY_REQUIRED) and are NEVER auto-retried, so a retry can
//     never duplicate an email.
//   - The service defaults to PAUSED after any restart. A persisted RUNNING
//     state at boot means the previous process died uncleanly and the worker
//     enters DEGRADED; PAUSE / EMERGENCY_STOP states are never bypassed.
//   - No message is ever sent to a real recipient during tests; tests inject
//     their own fetch.
'use strict';

const crypto = require('crypto');
const { createRepos } = require('../../db/repos');
const { writeEntry } = require('../../utils/auditLogger');
const { sendRaw, extractAddress } = require('../emailChannel');

const SERVICE_STATES = Object.freeze({
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  EMERGENCY_STOPPED: 'EMERGENCY_STOPPED',
  DEGRADED: 'DEGRADED'
});

const JOB_STATES = Object.freeze({
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  SENT: 'SENT',
  PROVIDER_CONFIRMED: 'PROVIDER_CONFIRMED',
  SEND_FAILED: 'SEND_FAILED',
  SEND_UNKNOWN: 'SEND_UNKNOWN',
  BLOCKED: 'BLOCKED',
  SUPPRESSED: 'SUPPRESSED',
  CANCELLED: 'CANCELLED'
});

const EMAIL_EVENTS = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.opened',
  'email.clicked'
]);

function fromBelongsToDomain(from, domain) {
  const addr = extractAddress(from);
  if (!addr) return false;
  return addr.split('@')[1].toLowerCase() === String(domain).toLowerCase();
}

function createWorker(opts) {
  const o = opts || {};

  function cfg() {
    const num = (envName, def) => {
      const raw = process.env[envName] !== undefined && process.env[envName] !== '' ? process.env[envName] : o[envName];
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : def;
    };
    return {
      apiKey: process.env.RESEND_API_KEY || o.resendApiKey || null,
      from: process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || o.from || 'info@elmahrosa.org',
      founderReportEmail: process.env.FOUNDER_REPORT_TO || process.env.FOUNDER_REPORT_EMAIL || o.founderReportTo || o.founderReportEmail || 'teosrgy@gmail.com',
      domain: process.env.RESEND_DOMAIN || o.domain || 'elmahrosa.org',
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET || o.webhookSecret || null,
      enabled: String(process.env.OUTREACH_ENABLED !== undefined ? process.env.OUTREACH_ENABLED : (o.enabled !== undefined ? o.enabled : 'false')) === 'true',
      emergencyStop: String(process.env.OUTREACH_EMERGENCY_STOP !== undefined ? process.env.OUTREACH_EMERGENCY_STOP : (o.emergencyStop !== undefined ? o.emergencyStop : 'false')) === 'true',
      requireVerifiedDomain: String(process.env.OUTREACH_REQUIRE_VERIFIED_DOMAIN !== undefined ? process.env.OUTREACH_REQUIRE_VERIFIED_DOMAIN : (o.requireVerifiedDomain !== undefined ? o.requireVerifiedDomain : 'true')) !== 'false',
      dailyLimit: num('OUTREACH_DAILY_LIMIT', o.dailyLimit !== undefined ? o.dailyLimit : 20),
      hourlyLimit: num('OUTREACH_HOURLY_LIMIT', o.hourlyLimit !== undefined ? o.hourlyLimit : 5),
      cooldownMinutes: num('PER_RECIPIENT_COOLDOWN_MINUTES', o.cooldownMinutes !== undefined ? o.cooldownMinutes : 1440),
      maxRetries: num('MAX_RETRIES', o.maxRetries !== undefined ? o.maxRetries : 3),
      maxQueueSize: num('MAX_QUEUE_SIZE', o.maxQueueSize !== undefined ? o.maxQueueSize : 500),
      pollMs: num('OUTREACH_POLL_MS', o.pollMs !== undefined ? o.pollMs : 5000),
      batchSize: num('OUTREACH_BATCH_SIZE', o.batchSize !== undefined ? o.batchSize : 5),
      leaseMs: num('OUTREACH_LEASE_MS', o.leaseMs !== undefined ? o.leaseMs : 60000),
      retryBaseMs: num('OUTREACH_RETRY_BASE_MS', o.retryBaseMs !== undefined ? o.retryBaseMs : 60000),
      retryMaxMs: num('OUTREACH_RETRY_MAX_MS', o.retryMaxMs !== undefined ? o.retryMaxMs : 3600000),
      timeoutMs: num('RESEND_TIMEOUT_MS', o.timeoutMs !== undefined ? o.timeoutMs : 15000),
      founderAlertMinIntervalMs: num('FOUNDER_ALERT_MIN_INTERVAL_MS', o.founderAlertMinIntervalMs !== undefined ? o.founderAlertMinIntervalMs : 300000)
    };
  }

  const log = o.log || ((...args) => console.log('[outboundWorker]', ...args));
  const fetchImpl = o.fetch || (typeof fetch === 'function' ? fetch : null);
  const lastAlert = {};

  function now() {
    return new Date().toISOString();
  }

  async function repos(adapter) {
    return createRepos(adapter);
  }

  function envStateFromConfig(c) {
    if (c.emergencyStop) return SERVICE_STATES.EMERGENCY_STOPPED;
    if (!c.enabled) return SERVICE_STATES.PAUSED;
    return null;
  }

  async function effectiveState(adapter, c) {
    const r = await repos(adapter);
    await r.outboundService.ensure();
    const env = envStateFromConfig(c || cfg());
    if (env) return env;
    const row = await r.outboundService.get();
    return row && row.state ? row.state : SERVICE_STATES.PAUSED;
  }

  function audit(adapter, workspaceId, actionType, status, details) {
    const safe = Object.assign({}, details || {});
    const r = createRepos(adapter);
    try {
      r.audit.add({
        workspace_id: workspaceId || null,
        agent_name: 'outbound_worker',
        action_type: actionType,
        details: safe
      });
    } catch (err) {
      log('audit trail write failed:', err.message);
    }
    try {
      writeEntry(actionType, safe.job_id != null ? String(safe.job_id) : 'system', status, safe);
    } catch (err) {
      log('audit vault write failed:', err.message);
    }
  }

  async function recover(adapter) {
    const r = await repos(adapter);
    const row = await r.outboundService.ensure();
    const c = cfg();
    const timestamp = now();

    if (c.emergencyStop) {
      if (row.state !== SERVICE_STATES.EMERGENCY_STOPPED) {
        await r.outboundService.set(SERVICE_STATES.EMERGENCY_STOPPED, {
          prior_state: row.state || null,
          reason: 'OUTREACH_EMERGENCY_STOP env override at boot',
          updated_by: 'system',
          updated_at: timestamp
        });
        audit(adapter, null, 'OUTREACH_EMERGENCY_STOP', 'denied', { reason: 'env override at boot' });
      }
      return { state: SERVICE_STATES.EMERGENCY_STOPPED, changed: row.state !== SERVICE_STATES.EMERGENCY_STOPPED };
    }

    if (row.state === SERVICE_STATES.RUNNING) {
      await r.outboundService.set(SERVICE_STATES.DEGRADED, {
        prior_state: SERVICE_STATES.RUNNING,
        reason: 'unclean worker shutdown detected on restart; explicit resume required',
        updated_by: 'system',
        updated_at: timestamp
      });
      audit(adapter, null, 'OUTBOUND_WORKER_CRASH_DETECTED', 'denied', { prior_state: SERVICE_STATES.RUNNING });
      return { state: SERVICE_STATES.DEGRADED, changed: true };
    }

    return { state: row.state || SERVICE_STATES.PAUSED, changed: false };
  }

  async function heartbeat(adapter) {
    const r = await repos(adapter);
    await r.outboundService.patch({ heartbeat_at: now(), last_worker_at: now() });
  }

  function idempotencyKey(workspaceId, data) {
    const version = crypto.createHash('sha256').update(`${data.subject}|${data.body}`).digest('hex').slice(0, 16);
    return crypto.createHash('sha256')
      .update(`${workspaceId}|${data.mission_id || ''}|${String(data.recipient || '').toLowerCase()}|${version}`)
      .digest('hex');
  }

  async function enqueue(adapter, data) {
    const r = await repos(adapter);
    const c = cfg();

    const workspaceId = data && data.workspace_id;
    if (!workspaceId) return { ok: false, error: 'workspace_required' };
    const ws = await r.workspaces.get(workspaceId);
    if (!ws) return { ok: false, error: 'workspace_not_found' };

    if (!data.recipient || !extractAddress(data.recipient)) {
      return { ok: false, error: 'invalid_recipient', reason: 'recipient is not a valid email address' };
    }
    if (!data.subject || !String(data.subject).trim()) return { ok: false, error: 'subject_required' };
    if (!data.body || !String(data.body).trim()) return { ok: false, error: 'body_required' };

    const from = data.from_email || c.from;
    if (c.requireVerifiedDomain && !fromBelongsToDomain(from, c.domain)) {
      return { ok: false, error: 'sender_not_verified', reason: `sender must belong to verified domain ${c.domain}` };
    }

    if (data.mission_id != null) {
      const mission = await r.plans.get(workspaceId, data.mission_id);
      if (!mission) return { ok: false, error: 'mission_not_found' };
    }
    if (data.prospect_id != null) {
      const prospect = await r.deals.get(workspaceId, data.prospect_id);
      if (!prospect) return { ok: false, error: 'prospect_not_found' };
    }

    if (r.emailSuppressions.isSuppressed(data.recipient)) {
      return { ok: false, error: 'suppressed', reason: 'recipient is suppressed by policy' };
    }

    let approvedBy;
    let approvedAt;
    if (data.approval_id != null) {
      const approval = await r.approvals.get(workspaceId, data.approval_id);
      if (!approval) return { ok: false, error: 'approval_not_found' };
      if (approval.status !== 'approved') {
        return { ok: false, error: 'approval_required', reason: `approval ${data.approval_id} is ${approval.status}, not approved` };
      }
      approvedBy = approval.decided_by || 'founder';
      approvedAt = approval.decided_at || now();
    } else {
      if (!data.approved_by || !data.approved_at) {
        return { ok: false, error: 'approval_required', reason: 'approved_by and approved_at are required when no approval_id is given' };
      }
      approvedBy = data.approved_by;
      approvedAt = data.approved_at;
    }

    const state = await effectiveState(adapter, c);
    if (state !== SERVICE_STATES.RUNNING) {
      return {
        ok: false,
        error: state === SERVICE_STATES.EMERGENCY_STOPPED ? 'emergency_stopped' : 'outreach_paused',
        reason: 'new outbound jobs are only accepted while the service is RUNNING',
        state
      };
    }

    const timestamp = now();
    const daily = await r.outboundJobs.countSentSince(startOfDay(timestamp));
    if (daily >= c.dailyLimit) {
      await this.pauseDueToLimit(adapter, 'daily_limit_reached', `daily limit ${c.dailyLimit} reached`);
      return { ok: false, error: 'daily_limit_reached', reason: `daily limit ${c.dailyLimit} reached` };
    }
    const hourly = await r.outboundJobs.countSentSince(new Date(Date.now() - 60 * 60 * 1000).toISOString());
    if (hourly >= c.hourlyLimit) {
      await this.pauseDueToLimit(adapter, 'hourly_limit_reached', `hourly limit ${c.hourlyLimit} reached`);
      return { ok: false, error: 'hourly_limit_reached', reason: `hourly limit ${c.hourlyLimit} reached` };
    }

    const queued = await r.outboundJobs.countByStatus(JOB_STATES.QUEUED);
    if (queued >= c.maxQueueSize) return { ok: false, error: 'queue_full', reason: `queue size limit ${c.maxQueueSize} reached` };

    const key = idempotencyKey(workspaceId, data);
    const existing = await r.outboundJobs.getByIdempotencyKey(key);
    if (existing) return { ok: true, duplicate: true, job: existing };

    let job;
    try {
      job = await r.outboundJobs.enqueue({
        workspace_id: workspaceId,
        mission_id: data.mission_id || null,
        prospect_id: data.prospect_id || null,
        approval_id: data.approval_id || null,
        recipient: String(data.recipient).trim(),
        from_email: from,
        subject: String(data.subject).trim(),
        body: String(data.body),
        template: data.template || null,
        idempotency_key: key,
        status: JOB_STATES.QUEUED,
        retry_count: 0,
        max_retries: c.maxRetries,
        next_attempt_at: timestamp,
        approved_by: approvedBy,
        approved_at: approvedAt
      });
    } catch (err) {
      const dup = await r.outboundJobs.getByIdempotencyKey(key);
      if (dup) return { ok: true, duplicate: true, job: dup };
      throw err;
    }

    audit(adapter, workspaceId, 'EMAIL_JOB_QUEUED', 'success', {
      job_id: job.id,
      recipient: job.recipient,
      mission_id: job.mission_id,
      prospect_id: job.prospect_id,
      approval_id: job.approval_id
    });
    return { ok: true, job };
  }

  function startOfDay(iso) {
    const d = new Date(iso);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }

  async function pauseDueToLimit(adapter, reason, message) {
    const r = await repos(adapter);
    const row = await r.outboundService.ensure();
    if (row.state !== SERVICE_STATES.PAUSED) {
      await r.outboundService.set(SERVICE_STATES.PAUSED, {
        prior_state: row.state || null,
        reason: message || reason,
        updated_by: 'policy',
        updated_at: now()
      });
      audit(adapter, null, 'OUTREACH_LIMIT_PAUSE', 'denied', { reason });
    }
  }

  async function gateSend(adapter, job, state) {
    const r = await repos(adapter);
    const c = cfg();
    if (state !== SERVICE_STATES.RUNNING) {
      return { ok: false, reason: 'not_running', detail: 'service is not RUNNING; no message sent' };
    }
    if (!c.apiKey) return { ok: false, reason: 'resend_not_configured', detail: 'RESEND_API_KEY is not configured; sending fails closed' };
    if (!job.recipient || !extractAddress(job.recipient)) return { ok: false, reason: 'invalid_recipient', detail: 'recipient is not a valid email address' };
    if (c.requireVerifiedDomain && !fromBelongsToDomain(job.from_email, c.domain)) {
      return { ok: false, reason: 'sender_not_verified', detail: `sender ${job.from_email} is not verified for domain ${c.domain}` };
    }
    if (r.emailSuppressions.isSuppressed(job.recipient)) {
      return { ok: false, reason: 'suppressed', detail: 'recipient is suppressed by policy' };
    }
    if (!job.approved_at || !job.approved_by) {
      return { ok: false, reason: 'approval_required', detail: 'explicit founder/authorized approval is required before sending' };
    }
    const dup = await r.outboundJobs.getByIdempotencyKey(job.idempotency_key);
    if (dup && dup.id !== job.id && [JOB_STATES.SENT, JOB_STATES.PROVIDER_CONFIRMED].includes(dup.status)) {
      return { ok: false, reason: 'duplicate_sent', detail: 'already sent for this governed action' };
    }
    return { ok: true };
  }

  async function processJob(adapter, job) {
    const r = await repos(adapter);
    const c = cfg();
    const timestamp = now();
    const state = await effectiveState(adapter, c);

    const gate = await gateSend(adapter, job, state);
    if (!gate.ok) {
      const terminal = gate.reason === 'suppressed' ? JOB_STATES.SUPPRESSED : JOB_STATES.BLOCKED;
      await r.outboundJobs.update(job.id, {
        status: terminal,
        failure_reason: gate.detail || gate.reason,
        lease_until: null,
        updated_at: timestamp
      });
      audit(adapter, job.workspace_id, 'EMAIL_JOB_BLOCKED', 'denied', { job_id: job.id, reason: gate.reason, message: gate.detail });
      return { sent: false, blocked: true, reason: gate.reason };
    }

    const res = await sendRaw({
      apiKey: c.apiKey,
      fetch: fetchImpl,
      from: job.from_email,
      to: job.recipient,
      subject: job.subject,
      text: job.body,
      timeoutMs: c.timeoutMs
    });

    if (res.ok) {
      await r.outboundJobs.update(job.id, {
        status: JOB_STATES.SENT,
        provider: 'resend',
        provider_message_id: res.provider_message_id,
        message_id_header: res.message_id_header || null,
        failure_reason: null,
        sent_at: timestamp,
        lease_until: null,
        updated_at: timestamp
      });
      await r.outboundService.patch({ last_successful_job_at: timestamp });
      audit(adapter, job.workspace_id, 'EMAIL_JOB_SENT', 'success', {
        job_id: job.id,
        recipient: job.recipient,
        provider: 'resend',
        provider_message_id: res.provider_message_id
      });
      this.notifyFounder(adapter, 'Outbound email sent', `Sent to ${job.recipient} (job #${job.id}). Provider id ${res.provider_message_id}.`);
      return { sent: true };
    }

    if (res.outcome === 'timeout' || res.outcome === 'provider_missing_message_id') {
      await r.outboundJobs.update(job.id, {
        status: JOB_STATES.SEND_UNKNOWN,
        failure_reason: res.outcome === 'timeout' ? 'timeout: verify required before any retry' : 'provider returned no verifiable message id: verify required',
        lease_until: null,
        updated_at: timestamp
      });
      audit(adapter, job.workspace_id, 'EMAIL_JOB_UNKNOWN', 'denied', { job_id: job.id, reason: res.outcome, message: res.detail });
      this.notifyFounder(adapter, 'Outbound delivery status unknown', `Job #${job.id} to ${job.recipient} could not be confirmed (${res.outcome}). Verify before any retry.`);
      return { sent: false, unknown: true, reason: res.outcome };
    }

    const retries = (job.retry_count || 0) + 1;
    if (res.outcome !== 'invalid_recipient' && retries <= (job.max_retries || c.maxRetries)) {
      const backoff = Math.min(c.retryBaseMs * Math.pow(2, job.retry_count || 0), c.retryMaxMs);
      await r.outboundJobs.update(job.id, {
        status: JOB_STATES.QUEUED,
        retry_count: retries,
        next_attempt_at: new Date(Date.now() + backoff).toISOString(),
        failure_reason: res.detail,
        lease_until: null,
        updated_at: timestamp
      });
      return { sent: false, retried: true, reason: res.outcome };
    }

    await r.outboundJobs.update(job.id, {
      status: JOB_STATES.SEND_FAILED,
      failure_reason: res.detail,
      lease_until: null,
      updated_at: timestamp
    });
    audit(adapter, job.workspace_id, 'EMAIL_JOB_SEND_FAILED', 'denied', { job_id: job.id, reason: res.outcome, message: res.detail });
    this.notifyFounder(adapter, 'Outbound delivery failure', `Job #${job.id} to ${job.recipient} failed (${res.outcome}). ${res.detail}`);
    return { sent: false, reason: res.outcome };
  }

  async function handleStale(adapter) {
    const r = await repos(adapter);
    const c = cfg();
    const timestamp = now();
    const stale = await r.outboundJobs.staleProcessing(c.batchSize);
    let reclaimed = 0;
    for (const job of stale) {
      if (!job.lease_until || String(job.lease_until) <= timestamp) {
        await r.outboundJobs.update(job.id, {
          status: JOB_STATES.SEND_UNKNOWN,
          failure_reason: 'lease expired: verify required before any retry',
          lease_until: null,
          updated_at: timestamp
        });
        audit(adapter, job.workspace_id, 'EMAIL_JOB_UNKNOWN', 'denied', { job_id: job.id, reason: 'lease_expired', message: 'verify required before any retry' });
        reclaimed += 1;
      }
    }
    return reclaimed;
  }

  async function tick(adapter) {
    const r = await repos(adapter);
    const c = cfg();
    await r.outboundService.ensure();
    await heartbeat(adapter);
    const timestamp = now();
    const state = await effectiveState(adapter, c);

    if (state !== SERVICE_STATES.RUNNING) {
      await handleStale(adapter);
      return { state, claimed: 0, processed: 0, sent: 0, staleOnly: true };
    }

    const daily = await r.outboundJobs.countSentSince(startOfDay(timestamp));
    if (daily >= c.dailyLimit) {
      await pauseDueToLimit.call(this, adapter, 'daily_limit_reached', `daily limit ${c.dailyLimit} reached`);
      return { state: SERVICE_STATES.PAUSED, claimed: 0, processed: 0, sent: 0, paused: 'daily_limit_reached' };
    }
    const hourly = await r.outboundJobs.countSentSince(new Date(Date.now() - 60 * 60 * 1000).toISOString());
    if (hourly >= c.hourlyLimit) {
      await pauseDueToLimit.call(this, adapter, 'hourly_limit_reached', `hourly limit ${c.hourlyLimit} reached`);
      return { state: SERVICE_STATES.PAUSED, claimed: 0, processed: 0, sent: 0, paused: 'hourly_limit_reached' };
    }

    const reclaimed = await handleStale.call(this, adapter);

    const due = await r.outboundJobs.due(c.batchSize);
    let claimed = 0;
    let processed = 0;
    let sent = 0;
    for (const job of due) {
      if (job.next_attempt_at && String(job.next_attempt_at) > timestamp) continue;

      const cooldownSince = new Date(Date.now() - c.cooldownMinutes * 60 * 1000).toISOString();
      const recent = await r.outboundJobs.countSentToRecipientSince(job.recipient, cooldownSince);
      if (recent > 0) {
        await r.outboundJobs.update(job.id, {
          next_attempt_at: new Date(Date.now() + c.cooldownMinutes * 60 * 1000).toISOString(),
          updated_at: timestamp
        });
        continue;
      }

      const claimedRow = await r.outboundJobs.claimIfQueued(job.id, {
        status: JOB_STATES.PROCESSING,
        lease_until: new Date(Date.now() + c.leaseMs).toISOString(),
        updated_at: timestamp
      });
      if (!claimedRow) continue;
      claimed += 1;
      processed += 1;
      const res = await processJob.call(this, adapter, claimedRow);
      if (res && res.sent) sent += 1;
    }

    return { state, claimed, processed, sent, reclaimed };
  }

  async function pause(adapter, by, reason) {
    const r = await repos(adapter);
    const row = await r.outboundService.ensure();
    const prev = row.state || SERVICE_STATES.PAUSED;
    await r.outboundService.set(SERVICE_STATES.PAUSED, {
      prior_state: prev === SERVICE_STATES.PAUSED ? null : prev,
      reason: reason || 'founder pause',
      updated_by: by || 'founder',
      updated_at: now()
    });
    audit(adapter, null, 'OUTREACH_PAUSED', 'success', { by: by || 'founder', reason: reason || 'founder pause', prior_state: prev });
    return { ok: true, state: SERVICE_STATES.PAUSED, prior_state: prev };
  }

  async function resume(adapter, by) {
    const c = cfg();
    const env = envStateFromConfig(c);
    if (env === SERVICE_STATES.EMERGENCY_STOPPED) {
      return { ok: false, error: 'emergency_stop_env_active', reason: 'OUTREACH_EMERGENCY_STOP is set; clear it before resuming' };
    }
    if (env === SERVICE_STATES.PAUSED) {
      return { ok: false, error: 'outreach_not_enabled', reason: 'OUTREACH_ENABLED must be true before the founder can resume' };
    }
    const r = await repos(adapter);
    const row = await r.outboundService.ensure();
    const prev = row.state || SERVICE_STATES.PAUSED;
    await r.outboundService.set(SERVICE_STATES.RUNNING, {
      prior_state: prev === SERVICE_STATES.RUNNING ? null : prev,
      reason: 'founder resume',
      updated_by: by || 'founder',
      updated_at: now()
    });
    audit(adapter, null, 'OUTREACH_RESUMED', 'success', { by: by || 'founder', prior_state: prev });
    return { ok: true, state: SERVICE_STATES.RUNNING, prior_state: prev };
  }

  async function emergencyStop(adapter, by, reason) {
    const r = await repos(adapter);
    const row = await r.outboundService.ensure();
    const prev = row.state || SERVICE_STATES.PAUSED;
    const timestamp = now();

    audit(adapter, null, 'OUTREACH_EMERGENCY_STOP', 'denied', {
      by: by || 'founder',
      reason: reason || 'emergency stop',
      prior_state: prev
    });

    await r.outboundService.set(SERVICE_STATES.EMERGENCY_STOPPED, {
      prior_state: prev,
      reason: reason || 'emergency stop',
      updated_by: by || 'founder',
      updated_at: timestamp
    });

    process.env.OUTREACH_EMERGENCY_STOP = 'true';

    const cancelled = await r.outboundJobs.cancelQueued(`emergency_stop${reason ? ': ' + reason : ''}`, by || 'founder');
    audit(adapter, null, 'OUTBOUND_QUEUE_CANCELLED', 'denied', { cancelled });
    this.notifyFounder(adapter, 'EMERGENCY STOP — outbound disabled', `All outbound email was disabled by ${by || 'founder'}. ${cancelled} queued job(s) cancelled.`, { force: true });
    return { ok: true, state: SERVICE_STATES.EMERGENCY_STOPPED, prior_state: prev, cancelled };
  }

  function verifyWebhookSignature(rawBody, headers) {
    const c = cfg();
    const secret = c.webhookSecret;
    if (!secret) return { ok: false, error: 'webhook_not_configured' };
    const id = headers['svix-id'] || headers['svix_id'] || '';
    const timestamp = headers['svix-timestamp'] || headers['svix_timestamp'] || '';
    const signatureHeader = headers['svix-signature'] || headers['svix_signature'] || '';
    const parts = String(signatureHeader).split(' ').filter(Boolean);
    if (!id || !timestamp || !parts.length) return { ok: false, error: 'invalid_signature' };

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return { ok: false, error: 'invalid_timestamp' };
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > 300) return { ok: false, error: 'stale_timestamp' };

    let key;
    try {
      key = Buffer.from(String(secret).replace(/^whsec_/i, ''), 'base64');
    } catch (_err) {
      return { ok: false, error: 'invalid_secret' };
    }
    const payload = `${id}.${timestamp}.${rawBody}`;
    const expected = crypto.createHmac('sha256', key).update(payload).digest();

    const valid = parts.some((part) => {
      const comma = part.indexOf(',');
      if (comma < 0) return false;
      const version = part.slice(0, comma);
      const provided = part.slice(comma + 1);
      if (!/^v\d+$/.test(version)) return false;
      let providedBuf;
      try {
        providedBuf = Buffer.from(provided, 'base64');
      } catch (_err) {
        return false;
      }
      if (!providedBuf || providedBuf.length !== expected.length) return false;
      return crypto.timingSafeEqual(providedBuf, expected);
    });

    if (!valid) return { ok: false, error: 'invalid_signature' };
    return { ok: true };
  }

  function applyEvent(adapter, type, data, job) {
    const r = createRepos(adapter);
    const timestamp = now();
    const messageIdHeader = (data.headers && (data.headers['Message-ID'] || data.headers['message-id'])) || null;
    const out = { suppress: null, jobUpdated: false };

    if (!job) return out;
    switch (type) {
      case 'email.sent':
        r.outboundJobs.update(job.id, { send_status: 'sent', message_id_header: messageIdHeader || job.message_id_header, updated_at: timestamp });
        out.jobUpdated = true;
        break;
      case 'email.delivered':
        r.outboundJobs.update(job.id, { status: JOB_STATES.PROVIDER_CONFIRMED, send_status: 'delivered', confirmed_at: timestamp, message_id_header: messageIdHeader || job.message_id_header, updated_at: timestamp });
        out.jobUpdated = true;
        break;
      case 'email.delivery_delayed':
        r.outboundJobs.update(job.id, { send_status: 'delayed', updated_at: timestamp });
        out.jobUpdated = true;
        break;
      case 'email.opened':
        r.outboundJobs.update(job.id, { send_status: 'opened', updated_at: timestamp });
        out.jobUpdated = true;
        break;
      case 'email.clicked':
        r.outboundJobs.update(job.id, { send_status: 'clicked', updated_at: timestamp });
        out.jobUpdated = true;
        break;
      case 'email.bounced':
        r.outboundJobs.update(job.id, { status: JOB_STATES.SEND_FAILED, send_status: 'bounced', failure_reason: 'bounce', confirmed_at: timestamp, updated_at: timestamp });
        out.suppress = 'bounce';
        out.jobUpdated = true;
        break;
      case 'email.complained':
        r.outboundJobs.update(job.id, { status: JOB_STATES.SEND_FAILED, send_status: 'complained', failure_reason: 'complaint', confirmed_at: timestamp, updated_at: timestamp });
        out.suppress = 'complaint';
        out.jobUpdated = true;
        break;
      case 'email.failed':
        {
          const bounceLike = Boolean(data.bounce) || /bounce/i.test(String(data.severity || data.category || ''));
          r.outboundJobs.update(job.id, { status: JOB_STATES.SEND_FAILED, send_status: 'failed', failure_reason: bounceLike ? 'bounce' : 'failed', confirmed_at: timestamp, updated_at: timestamp });
          if (bounceLike) out.suppress = 'bounce';
          out.jobUpdated = true;
        }
        break;
      default:
        break;
    }
    return out;
  }

  async function handleWebhook(adapter, event) {
    const r = await repos(adapter);
    const timestamp = now();
    const eventId = event && (event.id || event.event_id);
    if (!eventId) return { ok: false, error: 'missing_event_id' };

    const existing = await r.resendEvents.getByEventId(eventId);
    if (existing) {
      await r.outboundService.patch({ last_webhook_at: timestamp });
      return { ok: true, duplicate: true, event_id: eventId };
    }

    const type = event.type || event.event_type || 'unknown';
    const data = event.data || {};
    const emailId = data.email_id || data.id || null;
    let job = null;
    if (emailId) job = await r.outboundJobs.getByProviderMessageId(emailId);

    const messageIdHeader = (data.headers && (data.headers['Message-ID'] || data.headers['message-id'])) || null;
    const recipient = (data.to && (Array.isArray(data.to) ? data.to.join(', ') : data.to)) || (job ? job.recipient : null);

    try {
      await r.resendEvents.add({
        event_id: eventId,
        event_type: type,
        email_id: emailId,
        job_id: job ? job.id : null,
        message_id_header: messageIdHeader,
        recipient,
        payload: data,
        status: EMAIL_EVENTS.has(type) ? 'handled' : 'ignored'
      });
    } catch (err) {
      const dup = await r.resendEvents.getByEventId(eventId);
      if (dup) return { ok: true, duplicate: true, event_id: eventId };
      throw err;
    }
    await r.outboundService.patch({ last_webhook_at: timestamp });

    const applied = applyEvent(adapter, type, data, job);

    if (applied.suppress && job) {
      await r.emailSuppressions.add({
        workspace_id: job.workspace_id,
        email: job.recipient,
        reason: applied.suppress,
        source_event: type,
        source_job_id: job.id
      });
      const queued = await r.outboundJobs.list(job.workspace_id, { status: JOB_STATES.QUEUED });
      let suppressedJobs = 0;
      for (const q of queued) {
        if (String(q.recipient).toLowerCase() === String(job.recipient).toLowerCase()) {
          await r.outboundJobs.update(q.id, {
            status: JOB_STATES.SUPPRESSED,
            failure_reason: `${applied.suppress}: ${type}`,
            updated_at: timestamp
          });
          suppressedJobs += 1;
        }
      }
      audit(adapter, job.workspace_id, 'OUTBOUND_SUPPRESSED', 'denied', {
        email: job.recipient,
        reason: applied.suppress,
        source_event: type,
        job_id: job.id,
        suppressed_jobs: suppressedJobs
      });
      this.notifyFounder(adapter, `Outbound ${applied.suppress} — outreach blocked`, `Address ${job.recipient} ${applied.suppress} (${type}, job #${job.id}). Future outreach to this address is blocked until cleared by policy.`);
    }

    audit(adapter, job ? job.workspace_id : null, 'OUTBOUND_WEBHOOK_EVENT', 'success', {
      event_id: eventId,
      event_type: type,
      email_id: emailId,
      job_id: job ? job.id : null
    });

    return { ok: true, event: type, event_id: eventId, duplicate: false, job_id: job ? job.id : null, suppress: applied.suppress };
  }

  async function notifyFounder(adapter, subject, text, options) {
    const o = options || {};
    const c = cfg();
    const to = c.founderReportEmail;
    if (!to) return { skipped: true, reason: 'no_founder_report_email' };

    const key = String(subject);
    const nowMs = Date.now();
    const last = lastAlert[key];
    if (!o.force && last && nowMs - last < c.founderAlertMinIntervalMs) {
      return { skipped: true, reason: 'throttled' };
    }
    lastAlert[key] = nowMs;

    const res = await sendRaw({
      apiKey: c.apiKey,
      fetch: fetchImpl,
      from: c.from,
      to,
      subject,
      text: `${text}\n\n— TEOS DealMaker outbound ops`,
      timeoutMs: c.timeoutMs
    });

    if (!res.ok) {
      audit(adapter, null, 'FOUNDER_ALERT_SEND_FAILED', 'denied', { reason: res.reason, message: res.detail, to });
      return { ok: false, ...res };
    }
    audit(adapter, null, 'FOUNDER_ALERT_SENT', 'success', { subject, to, provider_message_id: res.provider_message_id });
    return { ok: true, provider_message_id: res.provider_message_id };
  }

  async function health(adapter) {
    const r = await repos(adapter);
    const row = await r.outboundService.ensure();
    const c = cfg();
    const state = await effectiveState(adapter, c);
    const timestamp = now();

    const queued = await r.outboundJobs.countByStatus(JOB_STATES.QUEUED);
    const processing = await r.outboundJobs.countByStatus(JOB_STATES.PROCESSING);
    const sendFailed = await r.outboundJobs.countByStatus(JOB_STATES.SEND_FAILED);
    const sendUnknown = await r.outboundJobs.countByStatus(JOB_STATES.SEND_UNKNOWN);
    const sentToday = await r.outboundJobs.countSentSince(startOfDay(timestamp));

    const degradedRecently = row.last_error_at && (Date.now() - new Date(row.last_error_at).getTime()) < 60 * 60 * 1000;
    const queueHealthy = state !== SERVICE_STATES.DEGRADED && !degradedRecently && queued <= c.maxQueueSize;

    return {
      ok: true,
      state,
      db_state: row.state || SERVICE_STATES.PAUSED,
      prior_state: row.prior_state || null,
      reason: row.reason || null,
      worker: state,
      outbound_email: state === SERVICE_STATES.RUNNING ? 'ENABLED' : 'DISABLED',
      queue: queueHealthy ? 'HEALTHY' : 'DEGRADED',
      resend: c.apiKey ? 'HEALTHY' : 'UNAVAILABLE',
      enabled: c.enabled,
      emergency_stop_env: c.emergencyStop,
      provider: 'Resend',
      from_email: c.from,
      verified_domain: c.domain,
      limits: {
        daily: c.dailyLimit,
        hourly: c.hourlyLimit,
        per_recipient_cooldown_minutes: c.cooldownMinutes,
        max_retries: c.maxRetries,
        max_queue_size: c.maxQueueSize
      },
      queue_counts: { queued, processing, send_failed: sendFailed, send_unknown: sendUnknown, sent_today: sentToday },
      last_successful_job: row.last_successful_job_at || null,
      last_webhook_event: row.last_webhook_at || null,
      last_error: row.last_error || null,
      last_error_at: row.last_error_at || null,
      heartbeat_at: row.heartbeat_at || null,
      last_worker_at: row.last_worker_at || null
    };
  }

  async function reportActivity(adapter, workspaceId) {
    const r = await repos(adapter);
    const jobs = await r.outboundJobs.list(workspaceId, { limit: 1000 });
    const timestamp = now();
    const counts = {};
    for (const s of Object.values(JOB_STATES)) counts[s] = 0;
    for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1;

    const sentToday = jobs.filter(j => ['SENT', 'PROVIDER_CONFIRMED'].includes(j.status) && j.sent_at && String(j.sent_at) >= String(startOfDay(timestamp))).length;
    const sent = jobs
      .filter(j => ['SENT', 'PROVIDER_CONFIRMED'].includes(j.status))
      .sort((a, b) => String(b.sent_at || '').localeCompare(String(a.sent_at || '')));

    const suppressions = (await r.emailSuppressions.list()).filter(s => !s.cleared_at && s.workspace_id === workspaceId);

    return {
      total_jobs: jobs.length,
      queued: counts[JOB_STATES.QUEUED],
      processing: counts[JOB_STATES.PROCESSING],
      sent: counts[JOB_STATES.SENT],
      provider_confirmed: counts[JOB_STATES.PROVIDER_CONFIRMED],
      send_failed: counts[JOB_STATES.SEND_FAILED],
      send_unknown: counts[JOB_STATES.SEND_UNKNOWN],
      blocked: counts[JOB_STATES.BLOCKED],
      suppressed_jobs: counts[JOB_STATES.SUPPRESSED],
      cancelled: counts[JOB_STATES.CANCELLED],
      sent_today: sentToday,
      suppression_count: suppressions.length,
      last_sent_at: sent.length ? sent[0].sent_at : null,
      last_sent: sent.length ? {
        id: sent[0].id,
        recipient: sent[0].recipient,
        subject: sent[0].subject,
        sent_at: sent[0].sent_at,
        provider_message_id: sent[0].provider_message_id || null
      } : null
    };
  }

  // Aggregate operational report for the founder's internal email (goes to the
  // founder report destination). Sanitized: counts, states, timestamps and
  // provider-confirmed message ids — never API keys, secrets, tokens, private
  // workspace ids or raw credentials. Requires a configured founder report
  // destination and a real RESEND_API_KEY; fails closed otherwise.
  async function sendFounderOpsReport(adapter, opts) {
    const o = opts || {};
    const r = await repos(adapter);
    const c = cfg();
    const to = o.to || c.founderReportEmail;
    const timestamp = now();

    const state = await effectiveState(adapter, c);
    const row = await r.outboundService.ensure();

    const allJobs = await adapter.find('outbound_jobs', {}, { limit: 10000 });
    const confirmed = allJobs
      .filter(j => j.status === JOB_STATES.PROVIDER_CONFIRMED && j.provider_message_id)
      .sort((a, b) => String(b.confirmed_at || '').localeCompare(String(a.confirmed_at || '')))
      .slice(0, 10)
      .map(j => ({ id: j.id, provider_message_id: j.provider_message_id, confirmed_at: j.confirmed_at }));

    const approvals = await adapter.find('approval_requests', {}, { limit: 10000 });
    const approvalCount = approvals.filter(a => a.status === 'approved').length;
    const rejectionCount = approvals.filter(a => ['rejected', 'denied'].includes(a.status)).length;

    const suppressions = (await r.emailSuppressions.list()).filter(s => !s.cleared_at);
    const retriedJobs = allJobs.filter(j => (j.retry_count || 0) > 0).length;

    const cS = (status) => allJobs.filter(j => j.status === status).length;

    const queued = cS(JOB_STATES.QUEUED);
    const processing = cS(JOB_STATES.PROCESSING);
    const sent = cS(JOB_STATES.SENT);
    const confirmedCount = cS(JOB_STATES.PROVIDER_CONFIRMED);
    const failed = cS(JOB_STATES.SEND_FAILED);
    const unknown = cS(JOB_STATES.SEND_UNKNOWN);

    const lines = [
      'TEOS DealMaker — Operations Report',
      `Generated: ${timestamp}`,
      '',
      `Service state   : ${state}`,
      `Worker state    : ${row.state || 'PAUSED'}`,
      `Outbound email  : ${state === SERVICE_STATES.RUNNING ? 'ENABLED' : 'DISABLED'}`,
      `Sender          : ${c.from}`,
      `Provider        : ${c.apiKey ? 'Resend (configured)' : 'NOT_CONFIGURED — OUTBOUND BLOCKED'}`,
      '',
      `Queue: ${queued} queued · ${processing} processing`,
      `Sent: ${sent} sent · ${confirmedCount} provider-confirmed`,
      `Failed: ${failed} failed · ${unknown} unknown (verify before retry)`,
      `Retried: ${retriedJobs} job(s) with retries`,
      `Suppressions: ${suppressions.length} active`,
      `Approvals: ${approvalCount} approved · ${rejectionCount} rejected`,
      `Sent today: ${await r.outboundJobs.countSentSince(startOfDay(timestamp))}`,
      '',
      'Provider-confirmed IDs (last 10):',
      confirmed.length ? confirmed.map(x => `  #${x.id} ${x.provider_message_id} (${(x.confirmed_at || '').slice(0, 19)})`).join('\n') : '  none yet',
      '',
      `Worker heartbeat: ${row.last_worker_at || 'never'}`,
      `Last successful job: ${row.last_successful_job_at || 'never'}`,
      `Last webhook event: ${row.last_webhook_at || 'never'}`,
      `Errors requiring attention: ${row.last_error ? `${row.last_error} @ ${row.last_error_at || 'unknown'}` : 'none'}`
    ].join('\n');

    if (!to) return { ok: false, reason: 'no_founder_report_destination' };
    if (!c.apiKey) {
      audit(adapter, null, 'FOUNDER_OPS_REPORT', 'denied', { reason: 'resend_not_configured' });
      return { ok: false, reason: 'resend_not_configured' };
    }

    const res = await sendRaw({
      apiKey: c.apiKey,
      fetch: fetchImpl,
      from: c.from,
      to,
      subject: `TEOS DealMaker Ops Report · ${timestamp.slice(0, 16)} UTC`,
      text: lines,
      timeoutMs: c.timeoutMs
    });

    if (!res.ok) {
      audit(adapter, null, 'FOUNDER_OPS_REPORT', 'denied', { reason: res.reason, message: res.detail, to });
      return { ok: false, ...res };
    }
    audit(adapter, null, 'FOUNDER_OPS_REPORT', 'success', { to, provider_message_id: res.provider_message_id, state, sent, failed, suppressed: suppressions.length });
    return { ok: true, provider_message_id: res.provider_message_id, state, summary: { queued, processing, sent, confirmed_count: confirmedCount, failed, unknown, retried: retriedJobs, suppressions: suppressions.length, approvals: approvalCount, rejections: rejectionCount } };
  }

  async function runLoop() {
    const { getAdapter } = require('../../db');
    try {
      const adapter = getAdapter();
      const result = await this.tick(adapter);
      if (result.error) {
        const r = createRepos(adapter);
        await r.outboundService.patch({ last_error: result.error, last_error_at: now() });
        const state = await this.effectiveState(adapter);
        if (state === SERVICE_STATES.RUNNING) {
          await r.outboundService.set(SERVICE_STATES.DEGRADED, {
            prior_state: SERVICE_STATES.RUNNING,
            reason: `worker error: ${result.error}`,
            updated_by: 'system'
          });
        }
      }
    } catch (err) {
      log('tick error:', err.message);
      try {
        const adapter = getAdapter();
        const r = createRepos(adapter);
        await r.outboundService.patch({ last_error: err.message, last_error_at: now() });
        const state = await this.effectiveState(adapter);
        if (state === SERVICE_STATES.RUNNING) {
          await r.outboundService.set(SERVICE_STATES.DEGRADED, {
            prior_state: SERVICE_STATES.RUNNING,
            reason: 'worker crashed; degraded until founder resumes',
            updated_by: 'system'
          });
          audit(adapter, null, 'OUTBOUND_WORKER_DEGRADED', 'denied', { message: err.message });
        }
      } catch (inner) {
        log('degraded state write failed:', inner.message);
      }
    }
  }

  function start() {
    if (this._timer) return { ok: true, alreadyRunning: true };
    const c = cfg();
    const adapter = require('../../db').getAdapter();
    recover(adapter).then(result => {
      log(`recovered on start: state=${result.state} changed=${result.changed}`);
    }).catch(err => log('recover failed:', err.message));
    this._timer = setInterval(() => runLoop.call(this), c.pollMs);
    if (this._timer && this._timer.unref) this._timer.unref();
    log(`started (poll ${c.pollMs}ms, batch ${c.batchSize})`);
    return { ok: true };
  }

  function stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  return {
    enqueue,
    tick,
    recover,
    effectiveState,
    gateSend,
    processJob,
    handleStale,
    pauseDueToLimit,
    pause,
    resume,
    emergencyStop,
    verifyWebhookSignature,
    handleWebhook,
    applyEvent,
    notifyFounder,
    health,
    reportActivity,
    sendFounderOpsReport,
    idempotencyKey,
    start,
    stop,
    runLoop,
    cfg,
    SERVICE_STATES,
    JOB_STATES
  };
}

const defaultWorker = createWorker();

module.exports = Object.assign(defaultWorker, { createWorker, SERVICE_STATES, JOB_STATES, fromBelongsToDomain });
