// services/revenueOps/approvals.js
// Founder alert layer for 24/7 Revenue Operations. Surfaces pending revenue
// approval requests and operational anomalies, and notifies the founder —
// fail-closed: nothing is sent without a configured destination and Resend.
// Every alert emission is written to the shared audit chain.
'use strict';

const { config, now } = require('./core');

async function repos(db) {
  return db.repos || require('../../db/repos').createRepos(db.adapter);
}

async function founderWorkspace(db) {
  return db.adapter.findOne('workspaces', { slug: 'workspace_founder' });
}

// Revenue-critical approval gates worth surfacing to the founder.
const REVENUE_GATES = new Set(['send_proposal', 'send_email', 'create_invoice', 'issue_refund', 'change_subscription', 'enable_live']);

async function pending(db) {
  const r = await repos(db);
  const ws = await founderWorkspace(db);
  if (!ws) return [];
  const rows = await r.approvals.list(ws.id, 'pending');
  return rows.filter(a => {
    const text = String(a.reason || '').toLowerCase();
    return REVENUE_GATES.has(text) || /proposal|invoice|refund|subscription|email|live/i.test(text);
  });
}

// Computes the current alert set from live state.
async function alerts(db) {
  const out = [];
  const pend = await pending(db);
  if (pend.length >= Number(process.env.SOR_APPROVAL_ALERT_THRESHOLD || 1)) {
    out.push({ level: 'attention', code: 'pending_approvals', message: `${pend.length} revenue approval(s) awaiting founder decision`, meta: { pending: pend.length } });
  }
  const failed = await db.adapter.find('founder_reports', { delivery_status: 'failed' }, { orderBy: 'window_end', order: 'desc', limit: 5 });
  if (failed.length) {
    out.push({ level: 'action', code: 'report_failed', message: `${failed.length} founder report(s) failed delivery`, meta: { failed: failed.length } });
  }
  const c = config();
  if (!c.resendConfigured) {
    out.push({ level: 'action', code: 'resend_not_configured', message: 'RESEND_API_KEY is not configured — founder reports will fail closed', meta: {} });
  }
  return out;
}

async function summary(db) {
  const pend = await pending(db);
  const al = await alerts(db);
  return { pendingApprovals: pend.length, approvals: pend.map(a => ({ id: a.id, agent_type: a.agent_type, reason: a.reason, requested_at: a.requested_at })), alerts: al, alertCount: al.length };
}

async function notifyFounder(db, opts) {
  const o = opts || {};
  const c = config();
  const { sendRaw } = require('../emailChannel');
  const to = o.to || c.founderEmail;
  const al = await alerts(db);
  if (!al.length && !o.force) return { ok: true, sent: false, alerts: 0, reason: 'no_alerts' };
  if (!c.resendConfigured) {
    await audit(db, 'REVENUE_OPS_ALERT', 'denied', { to, reason: 'resend_not_configured', alerts: al.length });
    return { ok: false, reason: 'resend_not_configured', alerts: al.length };
  }
  const lines = [
    'TEOS DealMaker — Revenue Ops Alerts',
    `Generated: ${now()}`,
    '',
    ...al.map(a => `[${a.level.toUpperCase()}] ${a.message}`),
    '',
    `Pending approvals: ${al.some(a => a.code === 'pending_approvals') ? al.find(a => a.code === 'pending_approvals').meta.pending : 0}`,
    '',
    'Law over Code — evidence over claims.'
  ].join('\n');
  const res = await sendRaw({
    apiKey: process.env.RESEND_API_KEY,
    from: c.from,
    to,
    subject: `TEOS DealMaker Revenue Ops Alerts · ${al.length} item(s)`,
    text: lines,
    timeoutMs: Number(process.env.RESEND_TIMEOUT_MS || 15000)
  });
  await audit(db, 'REVENUE_OPS_ALERT', res.ok ? 'success' : 'denied', { to, ok: res.ok, reason: res.reason || null, provider_message_id: res.provider_message_id || null, alerts: al.length });
  return { ok: res.ok, sent: res.ok, alerts: al.length, reason: res.reason || null };
}

async function audit(db, actionType, outcome, details) {
  const r = await repos(db);
  r.audit.add({
    workspace_id: null,
    agent_name: 'revenue-ops',
    action_type: actionType,
    timestamp: now(),
    details
  });
}

module.exports = { pending, alerts, summary, notifyFounder, REVENUE_GATES };
