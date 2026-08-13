const { now } = require('./core');

const STATUS_POINTS = Object.freeze({ SENT: 10, DELIVERED: 15, OPENED: 25, CLICKED: 35, REPLIED: 50 });

async function repos(db) {
  return db.repos || require('../../db/repos').createRepos(db.adapter);
}

function companyFromEmail(email) {
  const m = String(email || '').match(/@([^@\s]+)/);
  if (!m) return null;
  const host = m[1].toLowerCase().replace(/^www\./, '');
  return host.split('.').slice(0, -1).join('.') || host;
}

async function record(db, data) {
  const r = await repos(db);
  const email = String(data.contact_email || '').trim().toLowerCase();
  const company = data.company_name || companyFromEmail(email) || null;
  if (!email && !company) return { ok: false, reason: 'no_contact' };
  const where = email ? { contact_email: email } : { company_name: company };
  const existing = await db.adapter.findOne('prospects', where);
  const row = {
    company_name: company,
    person_name: data.person_name || null,
    website: data.website || null,
    source: data.source || 'SYSTEM',
    category: data.category || null,
    offer: data.offer || null,
    pain_point: data.pain_point || null,
    score: Number.isInteger(data.score) ? data.score : 0,
    score_reason: data.score_reason || null,
    score_source: data.score_source || data.source || null,
    score_timestamp: data.score_timestamp || now(),
    confidence: Number.isInteger(data.confidence) ? data.confidence : null,
    contact_email: email || null,
    contact_channel: data.contact_channel || null,
    status: data.status || 'DISCOVERED',
    stage: data.stage || 'discovered',
    qualification: data.qualification || null,
    sentinel_verdict: data.sentinel_verdict || null,
    mission_id: data.mission_id || null,
    audit_ref: data.audit_ref || null,
    last_action: data.last_action || null,
    next_action: data.next_action || null,
    metadata: data.metadata || null
  };
  if (existing) {
    const merged = Object.assign({}, row, { score: Math.max(existing.score || 0, row.score) });
    await db.adapter.update('prospects', { id: existing.id }, merged);
    return { ok: true, id: existing.id, created: false, updated: true };
  }
  const created = await r.prospects.create(row);
  return { ok: true, id: created.id, created: true, updated: false };
}

async function syncFromOutbound(db, limit) {
  const r = await repos(db);
  const ws = await db.adapter.findOne('workspaces', { slug: 'workspace_founder' });
  if (!ws) return { ok: true, created: 0, updated: 0, reason: 'no_founder_workspace' };
  const emails = await r.outboundEmails.list(ws.id, { limit: Number(limit || 200) });
  const seen = {};
  let created = 0;
  let updated = 0;
  for (const email of emails) {
    const to = String(email.to_email || '').trim().toLowerCase();
    if (!to || seen[to]) continue;
    seen[to] = true;
    const points = STATUS_POINTS[String(email.status || 'SENT').toUpperCase()] || 10;
    const res = await record(db, {
      contact_email: to,
      source: 'OUTBOUND',
      category: email.campaign || 'cold-outreach',
      score: points,
      score_reason: `engagement status ${email.status}`,
      score_source: 'outbound_email',
      status: points >= STATUS_POINTS.REPLIED ? 'ENGAGED' : points >= STATUS_POINTS.OPENED ? 'QUALIFIED' : 'DISCOVERED',
      last_action: email.status || 'SENT',
      metadata: { outbound_email_id: email.id, subject: email.subject || null }
    });
    if (res.created) created += 1;
    else if (res.updated) updated += 1;
  }
  return { ok: true, created, updated };
}

module.exports = { record, syncFromOutbound, companyFromEmail, STATUS_POINTS };
