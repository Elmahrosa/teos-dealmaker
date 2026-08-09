// Governed Resend outbound email channel.
//
// Fail-closed by design:
//   - RESEND_API_KEY must be configured or sending is refused (no external call).
//   - Explicit founder/mission approval is required before any send. Drafting a
//     message is never approval.
//   - SENT is recorded only when Resend returns a 2xx response containing a
//     verifiable message id. Any other outcome is SEND_FAILED with a reason.
//   - No approval, no API key, invalid recipient, provider error, network error
//     or timeout => no send and no false SENT state.
//
// Lifecycle states:
//   DRAFT -> PENDING_APPROVAL -> SENT -> PROVIDER_CONFIRMED
//   with REJECTED and SEND_FAILED as terminal states.
//
// Every transition is written both to the workspace audit trail and to the
// hash-chained vault. The API key never leaves the configuration layer and is
// never logged or returned by the report surface.
'use strict';

const { writeEntry } = require('../../utils/auditLogger');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DISPLAY_NAME_RE = /^[^<]*<([^\s@]+@[^\s@]+\.[^\s@]{2,})>$/;
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function extractAddress(value) {
  const v = String(value).trim();
  if (EMAIL_RE.test(v)) return v;
  const match = DISPLAY_NAME_RE.exec(v);
  return match ? match[1] : null;
}

async function safeText(res) {
  try {
    return await res.text();
  } catch (_err) {
    return '';
  }
}

async function extractMessageId(res) {
  let data;
  try {
    data = await res.json();
  } catch (_err) {
    return null;
  }
  const id = data && data.id;
  if (typeof id !== 'string' || !/^[\w.-]+$/i.test(id.trim()) || !id.trim()) return null;
  return id.trim();
}

// Low-level governed send: performs the Resend POST and returns a structured
// result. Never reports success without a verifiable provider message id.
async function sendRaw(opts) {
  const o = opts || {};
  const apiKey = o.apiKey || process.env.RESEND_API_KEY || null;
  const fetchImpl = o.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!apiKey) {
    return { ok: false, outcome: 'no_api_key', reason: 'resend_not_configured', detail: 'RESEND_API_KEY is not configured; sending fails closed' };
  }
  if (!fetchImpl) {
    return { ok: false, outcome: 'no_fetch', reason: 'no_fetch', detail: 'no fetch implementation available; sending fails closed' };
  }
  const to = String(o.to || '').trim();
  if (!to || !extractAddress(to)) {
    return { ok: false, outcome: 'invalid_recipient', reason: 'invalid_recipient', detail: 'recipient is not a valid email address' };
  }
  const timeoutMs = Number(o.timeoutMs || process.env.RESEND_TIMEOUT_MS || 15000) || 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: String(o.from || ''),
        to: [to],
        subject: String(o.subject || ''),
        text: String(o.text || '')
      }),
      signal: controller.signal
    });
  } catch (err) {
    const outcome = err && err.name === 'AbortError' ? 'timeout' : 'network_error';
    return { ok: false, outcome, reason: outcome, detail: (err && err.message) || outcome };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await safeText(res);
    return { ok: false, outcome: 'provider_error', reason: 'provider_error', status: res.status, detail: `Resend HTTP ${res.status}: ${detail.slice(0, 200)}` };
  }
  const providerMessageId = await extractMessageId(res);
  if (!providerMessageId) {
    return { ok: false, outcome: 'provider_missing_message_id', reason: 'provider_missing_message_id', detail: 'Resend returned success without a verifiable message id' };
  }
  let messageIdHeader = null;
  try {
    messageIdHeader = res.headers && typeof res.headers.get === 'function' ? res.headers.get('message-id') : null;
  } catch (_err) {
    messageIdHeader = null;
  }
  return { ok: true, provider_message_id: providerMessageId, message_id_header: messageIdHeader };
}

const STATES = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  REJECTED: 'REJECTED',
  SEND_FAILED: 'SEND_FAILED',
  SENT: 'SENT',
  PROVIDER_CONFIRMED: 'PROVIDER_CONFIRMED'
});

function createEmailChannel(opts) {
  const o = opts || {};
  const fetchImpl = o.fetch || (typeof fetch === 'function' ? fetch : null);
  const log = o.log || ((...args) => console.log('[emailChannel]', ...args));

  function config() {
    return {
      apiKey: process.env.RESEND_API_KEY || o.resendApiKey || null,
      from: process.env.EMAIL_FROM || o.from || 'TEOS DealMaker <no-reply@elmahrosa.org>',
      timeoutMs: Number(process.env.RESEND_TIMEOUT_MS || o.timeoutMs || 15000) || 15000
    };
  }

  function validateEmail(value, field) {
    if (value !== undefined && value !== null && extractAddress(value)) return null;
    return `${field} is not a valid email address`;
  }

  function audit(repos, email, actionType, status, details) {
    const safe = Object.assign(
      { email_id: email && email.id != null ? email.id : null },
      details || {}
    );
    try {
      repos.audit.add({
        workspace_id: email && email.workspace_id ? email.workspace_id : null,
        agent_name: 'email_channel',
        action_type: actionType,
        details: safe
      });
    } catch (err) {
      log('audit trail write failed:', err.message);
    }
    try {
      writeEntry(actionType, email && email.id != null ? String(email.id) : 'system', status, safe);
    } catch (err) {
      log('audit vault write failed:', err.message);
    }
  }

  async function createDraft(repos, data) {
    const workspaceId = data && data.workspace_id;
    if (!workspaceId) return { ok: false, error: 'workspace_required' };
    const toErr = validateEmail(data && data.to, 'recipient');
    if (toErr) return { ok: false, error: 'invalid_recipient', reason: toErr };
    const fromErr = validateEmail(data && data.from, 'sender');
    if (fromErr) return { ok: false, error: 'invalid_sender', reason: fromErr };
    if (!data.subject || !String(data.subject).trim()) return { ok: false, error: 'subject_required' };
    if (!data.body || !String(data.body).trim()) return { ok: false, error: 'body_required' };
    const record = await repos.outboundEmails.create({
      workspace_id: workspaceId,
      to_email: String(data.to).trim(),
      from_email: String(data.from).trim(),
      subject: String(data.subject).trim(),
      body: String(data.body),
      status: STATES.DRAFT,
      campaign: data.campaign || null
    });
    audit(repos, record, 'EMAIL_DRAFTED', 'success', { to: record.to_email, campaign: record.campaign });
    return { ok: true, email: record };
  }

  async function requestApproval(repos, workspaceId, emailId, details) {
    const email = await repos.outboundEmails.get(workspaceId, emailId);
    if (!email) return { ok: false, error: 'not_found' };
    if (email.status !== STATES.DRAFT) {
      return { ok: false, error: 'invalid_state', state: email.status };
    }
    const updated = await repos.outboundEmails.update(workspaceId, emailId, {
      status: STATES.PENDING_APPROVAL,
      requested_at: new Date().toISOString()
    });
    audit(repos, updated, 'EMAIL_APPROVAL_REQUESTED', 'success', {
      reason: details && details.reason ? String(details.reason) : null
    });
    return { ok: true, email: updated };
  }

  async function approve(repos, workspaceId, emailId, details) {
    const email = await repos.outboundEmails.get(workspaceId, emailId);
    if (!email) return { ok: false, error: 'not_found' };
    if (email.status !== STATES.PENDING_APPROVAL) {
      return { ok: false, error: 'invalid_state', state: email.status };
    }
    const approvedBy = details && details.approved_by ? String(details.approved_by) : 'founder';
    const updated = await repos.outboundEmails.update(workspaceId, emailId, {
      approved_by: approvedBy,
      approved_at: new Date().toISOString()
    });
    audit(repos, updated, 'EMAIL_APPROVED', 'success', { approved_by: approvedBy });
    return { ok: true, email: updated };
  }

  async function reject(repos, workspaceId, emailId, details) {
    const email = await repos.outboundEmails.get(workspaceId, emailId);
    if (!email) return { ok: false, error: 'not_found' };
    if (email.status !== STATES.PENDING_APPROVAL && email.status !== STATES.DRAFT) {
      return { ok: false, error: 'invalid_state', state: email.status };
    }
    const rejectedBy = details && details.rejected_by ? String(details.rejected_by) : 'founder';
    const reason = details && details.reason ? String(details.reason) : 'rejected';
    const updated = await repos.outboundEmails.update(workspaceId, emailId, {
      status: STATES.REJECTED,
      rejected_by: rejectedBy,
      rejected_at: new Date().toISOString(),
      failure_reason: reason
    });
    audit(repos, updated, 'EMAIL_REJECTED', 'denied', { rejected_by: rejectedBy, reason });
    return { ok: true, email: updated };
  }

  async function send(repos, workspaceId, emailId) {
    const email = await repos.outboundEmails.get(workspaceId, emailId);
    if (!email) return { ok: false, error: 'not_found' };
    if (email.status !== STATES.PENDING_APPROVAL) {
      return {
        ok: false,
        error: 'approval_required',
        reason: 'email must be PENDING_APPROVAL and explicitly approved before sending',
        state: email.status
      };
    }
    if (!email.approved_at || !email.approved_by) {
      return {
        ok: false,
        error: 'approval_required',
        reason: 'explicit founder/mission approval is required before sending'
      };
    }
    const cfg = config();
    if (!cfg.apiKey) {
      const updated = await fail(repos, email, 'resend_not_configured', 'RESEND_API_KEY is not configured; sending fails closed');
      return { ok: false, error: 'resend_not_configured', email: updated };
    }
    if (!fetchImpl) {
      const updated = await fail(repos, email, 'no_fetch', 'no fetch implementation available; sending fails closed');
      return { ok: false, error: 'no_fetch', email: updated };
    }
    const toErr = validateEmail(email.to_email, 'recipient');
    if (toErr) {
      const updated = await fail(repos, email, 'invalid_recipient', toErr);
      return { ok: false, error: 'invalid_recipient', email: updated };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    let res;
    try {
      res = await fetchImpl(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + cfg.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: email.from_email,
          to: [email.to_email],
          subject: email.subject,
          text: email.body
        }),
        signal: controller.signal
      });
    } catch (err) {
      const reason = err && err.name === 'AbortError' ? 'timeout' : 'network_error';
      const updated = await fail(repos, email, reason, (err && err.message) || reason);
      return { ok: false, error: reason, email: updated };
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = await safeText(res);
      const updated = await fail(repos, email, 'provider_error', `Resend HTTP ${res.status}: ${detail.slice(0, 200)}`);
      return { ok: false, error: 'provider_error', email: updated };
    }

    const messageId = await extractMessageId(res);
    if (!messageId) {
      const updated = await fail(repos, email, 'provider_missing_message_id', 'Resend returned success without a verifiable message id');
      return { ok: false, error: 'provider_missing_message_id', email: updated };
    }

    const now = new Date().toISOString();
    const updated = await repos.outboundEmails.update(workspaceId, emailId, {
      status: STATES.SENT,
      provider: 'resend',
      provider_message_id: messageId,
      send_status: 'accepted',
      sent_at: now,
      failure_reason: null
    });
    audit(repos, updated, 'EMAIL_SENT', 'success', {
      provider: 'resend',
      provider_message_id: messageId,
      to: email.to_email
    });
    return { ok: true, email: updated };
  }

  async function confirmFromProvider(repos, workspaceId, emailId, details) {
    const email = await repos.outboundEmails.get(workspaceId, emailId);
    if (!email) return { ok: false, error: 'not_found' };
    if (email.status !== STATES.SENT) {
      return { ok: false, error: 'invalid_state', state: email.status };
    }
    const providerStatus = details && details.status ? String(details.status) : 'delivered';
    const updated = await repos.outboundEmails.update(workspaceId, emailId, {
      status: STATES.PROVIDER_CONFIRMED,
      send_status: providerStatus,
      confirmed_at: new Date().toISOString()
    });
    audit(repos, updated, 'EMAIL_PROVIDER_CONFIRMED', 'success', { provider_status: providerStatus });
    return { ok: true, email: updated };
  }

  async function fail(repos, email, reason, message) {
    const note = message && message !== reason ? `${reason}: ${message}` : reason;
    const updated = await repos.outboundEmails.update(email.workspace_id, email.id, {
      status: STATES.SEND_FAILED,
      send_status: 'failed',
      failure_reason: note
    });
    audit(repos, updated, 'EMAIL_SEND_FAILED', 'denied', { reason, message: note });
    return updated;
  }

  function toReport(record) {
    return {
      id: record.id,
      workspace_id: record.workspace_id,
      status: record.status,
      campaign: record.campaign || null,
      to_email: record.to_email,
      from_email: record.from_email,
      subject: record.subject,
      provider: record.provider || null,
      provider_message_id: record.provider_message_id || null,
      send_status: record.send_status || null,
      failure_reason: record.failure_reason || null,
      requested_at: record.requested_at || null,
      approved_at: record.approved_at || null,
      approved_by: record.approved_by || null,
      rejected_at: record.rejected_at || null,
      rejected_by: record.rejected_by || null,
      sent_at: record.sent_at || null,
      confirmed_at: record.confirmed_at || null,
      created_at: record.created_at || null,
      updated_at: record.updated_at || null
    };
  }

  async function list(repos, workspaceId, opts) {
    const o = opts || {};
    const rows = await repos.outboundEmails.list(workspaceId, { status: o.status, limit: o.limit });
    return rows.map(toReport);
  }

  return {
    createDraft,
    requestApproval,
    approve,
    reject,
    send,
    confirmFromProvider,
    list,
    toReport,
    validateEmail,
    STATES,
    RESEND_ENDPOINT
  };
}

module.exports = { createEmailChannel, sendRaw, extractAddress, STATES, EMAIL_RE };
