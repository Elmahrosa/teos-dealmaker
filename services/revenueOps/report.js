const { config, now, KEY_LAST_REPORT, KEY_LAST_WINDOW } = require('./core');

function windowEndOf(ts, intervalMs) {
  return Math.floor(new Date(ts).getTime() / intervalMs) * intervalMs;
}

function windowLabel(endMs) {
  const d = new Date(endMs);
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function uuid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function pgCount(db, sql, params) {
  if (db.pg) {
    const res = await db.pg.query(sql, params);
    return Number(res.rows[0].count || 0);
  }
  return null;
}

async function collectMetrics(db, windowStartMs, windowEndMs) {
  const { createRepos } = require('../../db/repos');
  const r = createRepos(db.adapter);
  const ws = await db.adapter.findOne('workspaces', { slug: 'workspace_founder' });
  const workspaceId = ws ? ws.id : null;
  const startIso = new Date(windowStartMs).toISOString();
  const endIso = new Date(windowEndMs).toISOString();
  const delivered = "NOT IN ('DRAFT','QUEUED','PROCESSING','FAILED','BOUNCED','COMPLAINT')";
  const c = {};
  c.sent = await pgCount(db, `SELECT COUNT(*)::int AS count FROM outbound_emails WHERE status ${delivered} AND created_at >= $1 AND created_at < $2`, [startIso, endIso]);
  c.failed = await pgCount(db, "SELECT COUNT(*)::int AS count FROM outbound_emails WHERE status IN ('FAILED','BOUNCED','COMPLAINT') AND created_at >= $1 AND created_at < $2", [startIso, endIso]);
  c.auditEntries = await pgCount(db, 'SELECT COUNT(*)::int AS count FROM audit_trail WHERE timestamp >= $1 AND timestamp < $2', [startIso, endIso]);
  c.prospectsAdded = await pgCount(db, 'SELECT COUNT(*)::int AS count FROM prospects WHERE created_at >= $1 AND created_at < $2', [startIso, endIso]);

  const deliveredSet = new Set(['SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'REPLIED']);
  const failedSet = new Set(['FAILED', 'BOUNCED', 'COMPLAINT']);
  const [emails, auditRows, prospectRows, queued, approvals, deals] = await Promise.all([
    workspaceId ? r.outboundEmails.list(workspaceId, {}) : Promise.resolve([]),
    db.adapter.find('audit_trail', {}, { orderBy: 'timestamp', order: 'desc', limit: 5000 }),
    db.adapter.find('prospects', {}, { orderBy: 'id', order: 'desc', limit: 5000 }),
    workspaceId ? r.outboundJobs.list(workspaceId, { status: 'QUEUED' }) : Promise.resolve([]),
    workspaceId ? r.approvals.list(workspaceId, 'pending') : Promise.resolve([]),
    workspaceId ? r.deals.list(workspaceId) : Promise.resolve([])
  ]);
  if (c.sent === null) c.sent = emails.filter(x => deliveredSet.has(String(x.status || '').toUpperCase()) && x.created_at >= startIso && x.created_at < endIso).length;
  if (c.failed === null) c.failed = emails.filter(x => failedSet.has(String(x.status || '').toUpperCase()) && x.created_at >= startIso && x.created_at < endIso).length;
  if (c.auditEntries === null) c.auditEntries = auditRows.filter(x => x.timestamp >= startIso && x.timestamp < endIso).length;
  if (c.prospectsAdded === null) c.prospectsAdded = prospectRows.filter(x => x.created_at >= startIso && x.created_at < endIso).length;

  const stageCounts = {};
  (deals || []).forEach(d => {
    stageCounts[d.stage || d.status || 'unknown'] = (stageCounts[d.stage || d.status || 'unknown'] || 0) + 1;
  });
  const skipRow = await db.adapter.findOne('revenue_ops_state', { key: 'sor_last_window_skip' });
  const skippedWindows = skipRow && skipRow.payload ? Object.assign({}, skipRow.payload) : null;
  return {
    windowStart: startIso,
    windowEnd: endIso,
    sent: c.sent,
    failed: c.failed,
    queued: (queued || []).length,
    pendingApprovals: (approvals || []).filter(a => String(a.status).toLowerCase() === 'pending').length,
    rejectedApprovals: 0,
    auditEntries: c.auditEntries,
    prospectsAdded: c.prospectsAdded,
    reportsTotal: await db.adapter.count('founder_reports', {}),
    deals: (deals || []).length,
    dealStages: stageCounts,
    skippedWindows
  };
}

function renderText(m) {
  return [
    'TEOS DealMaker — 24/7 Revenue Ops Report',
    `Window  : ${m.windowStart.replace('T', ' ').slice(0, 16)} → ${m.windowEnd.replace('T', ' ').slice(0, 16)} UTC`,
    `Generated: ${now()}`,
    '',
    'Pipeline',
    `  Deals in progress  : ${m.deals}`,
    `  Deal stages        : ${Object.keys(m.dealStages).length ? Object.entries(m.dealStages).map(([k, v]) => `${k}=${v}`).join(' · ') : 'n/a'}`,
    `  Pending approvals  : ${m.pendingApprovals} (rejected in window: ${m.rejectedApprovals})`,
    '',
    'Outbound',
    `  Sent in window     : ${m.sent}`,
    `  Failed in window   : ${m.failed}`,
    `  Queued now         : ${m.queued}`,
    '',
    'Coverage',
    m.skippedWindows && m.skippedWindows.skipped
      ? `  Windows skipped    : ${m.skippedWindows.skipped} (backfill cap ${m.skippedWindows.cap})`
      : '  Windows skipped    : 0',
    `  Skipped range      : ${m.skippedWindows && m.skippedWindows.skipped ? `${m.skippedWindows.from.replace('T', ' ').slice(0, 16)} → ${m.skippedWindows.to.replace('T', ' ').slice(0, 16)} UTC` : '—'}`,
    '',
    'Governance',
    `  Audit entries      : ${m.auditEntries}`,
    `  Prospects recorded : ${m.prospectsAdded}`,
    `  Reports persisted  : ${m.reportsTotal}`,
    '',
    'Law over Code — evidence over claims. Founder-controlled; nothing auto-sends without policy.'
  ].join('\n');
}

async function sendReport(db, row, metrics) {
  const { sendRaw } = require('../emailChannel');
  const c = config();
  if (!c.resendConfigured) {
    await db.adapter.update('founder_reports', { report_id: row.report_id }, { delivery_status: 'failed', failure_reason: 'resend_not_configured', last_attempt_at: now() });
    return { ok: false, reason: 'resend_not_configured' };
  }
  const res = await sendRaw({
    apiKey: process.env.RESEND_API_KEY,
    from: c.from,
    to: row.recipient,
    subject: row.subject,
    text: renderText(metrics),
    timeoutMs: Number(process.env.RESEND_TIMEOUT_MS || 15000)
  });
  if (res.ok) {
    await db.adapter.update('founder_reports', { report_id: row.report_id }, {
      delivery_status: 'sent',
      provider: 'resend',
      provider_message_id: res.provider_message_id,
      last_attempt_at: now()
    });
    return { ok: true, provider_message_id: res.provider_message_id };
  }
  const retries = (row.resend_count || 0) + 1;
  const retryable = retries <= (Number(process.env.SOR_MAX_REPORT_RETRIES || 3));
  await db.adapter.update('founder_reports', { report_id: row.report_id }, {
    delivery_status: retryable ? 'pending_retry' : 'failed',
    failure_reason: res.detail || res.reason || 'send_failed',
    resend_count: retries,
    last_attempt_at: now()
  });
  return { ok: false, reason: res.reason, retryable, detail: res.detail };
}

async function generateAndSend(db, windowStartMs, windowEndMs) {
  const c = config();
  const r = require('../../db/repos').createRepos(db.adapter);
  const metrics = await collectMetrics(db, windowStartMs, windowEndMs);
  await r.revenueOps.set('sor_last_window_skip', null);
  const reportId = `fr_${uuid().slice(0, 8)}_${Math.round(windowEndMs / 1000)}`;
  const subject = `TEOS DealMaker Revenue Ops · ${windowLabel(windowEndMs)} UTC`;
  const row = await r.founderReports.create({
    report_id: reportId,
    window_start: new Date(windowStartMs).toISOString(),
    window_end: new Date(windowEndMs).toISOString(),
    period_label: windowLabel(windowEndMs),
    generated_at: now(),
    recipient: c.founderEmail,
    sender: c.from,
    subject,
    delivery_status: 'generated',
    metrics
  });
  r.audit.add({
    workspace_id: null,
    agent_name: 'revenue-ops',
    action_type: 'FOUNDER_REPORT_GENERATED',
    timestamp: now(),
    details: { report_id: reportId, window_end: metrics.windowEnd }
  });
  const sent = await sendReport(db, row, metrics);
  r.audit.add({
    workspace_id: null,
    agent_name: 'revenue-ops',
    action_type: 'FOUNDER_REPORT_DELIVERY',
    timestamp: now(),
    details: { report_id: reportId, ok: sent.ok, reason: sent.reason || null, provider_message_id: sent.provider_message_id || null }
  });
  return { reportId, metrics, delivery: sent };
}

async function recordLastWindow(db, windowEndMs, reportId) {
  const r = require('../../db/repos').createRepos(db.adapter);
  await r.revenueOps.set(KEY_LAST_WINDOW, new Date(windowEndMs).toISOString());
  if (reportId) await r.revenueOps.set(KEY_LAST_REPORT, reportId);
}

module.exports = { windowEndOf, windowLabel, collectMetrics, renderText, sendReport, generateAndSend, recordLastWindow };
