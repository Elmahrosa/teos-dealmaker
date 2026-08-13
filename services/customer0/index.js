'use strict';

// services/customer0/index.js
//
// Customer #0: TEOS DealMaker sells to TEOS DealMaker.
//
// This module runs the self-sale mission against the existing governed
// architecture. Nothing here creates a new approval mechanism, a new send
// path, or a new auth surface:
//
//   - Outreach drafts live in outbound_emails and are governed by the
//     existing PENDING_APPROVAL lifecycle (services/emailChannel).
//   - Decisions require the founder session (server middleware already used
//     by /api/admin/command-center/*). Forged or expired sessions are
//     rejected before this module is reached.
//   - Approval/denial stamps go through emailChannel.approve / .reject; the
//     status only moves to SENT after the outbound worker is RUNNING, the
//     Resend key is configured, and the approval is present.
//   - Every decision and consequential action is written to the audit trail.
//   - Nothing is ever sent here: the worker refuses to enqueue unless the
//     service is RUNNING and approval is present; with OUTREACH paused this
//     returns a recorded 'blocked' outcome.
//
// The mission report is the existing 3-hour founder report; it gains a
// Customer #0 section (top opportunity, scorecard, pending outreach, revenue
// progress) plus a "NO MATERIAL CHANGE" line when the fingerprint is
// unchanged, instead of fabricating activity.

const crypto = require('crypto');
const { writeEntry } = require('../../utils/auditLogger');
const { createEmailChannel } = require('../emailChannel');
const { scoreProspect } = require('../revenueOps/scorecard');
const founderSeed = require('../founderSeed');
const product = require('../../config/product.config');
const { config: sorConfig, KEY_MODE } = require('../revenueOps/core');

const MISSION = 'customer0';
const CAMPAIGN_PREFIX = 'customer0:prospect_';
const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000;
const EMAIL_FROM = process.env.EMAIL_FROM || 'info@elmahrosa.org';

const CUSTOMER0_SEED_PROSPECTS = [
  {
    company_name: 'Bosta',
    person_name: 'Mohamed Ezzat',
    website: 'https://bosta.co',
    source: 'PUBLIC_RESEARCH',
    category: 'logistics',
    offer: 'Governed AI revenue workforce for the new B2B heavy-transport outbound motion',
    pain_point: 'The new factory-to-retailer B2B sales motion needs qualified pipeline ahead of the 2026 IPO-track revenue targets.',
    contact_email: 'hello@bosta.co',
    status: 'ACTIVE',
    stage: 'recommended',
    metadata: {
      country: 'Egypt',
      geo_region: 'MENA',
      buyer_role: 'CEO & Co-founder',
      funding: '$32M round in flight (Fawry/EFG corridor); IPO-track',
      urgency_estimate: 'HIGH — 2026 IPO-track and an 80M parcel delivery target',
      evidence: [
        {
          source: 'fwdstart.me (2026-02)',
          summary: 'IPO preparation (~$170M EGX raise), $32M round, 37M parcels 2025 heading to 80M in 2026, new B2B heavy-transport expansion, Egypt/UAE/KSA footprint.'
        }
      ],
      dimensions: {
        icp_fit: 4, revenue_pain: 4, urgency: 5, company_maturity: 4,
        buyer_authority: 4, budget_potential: 5, tech_ai_fit: 3,
        governance_security_fit: 4, geo_priority: 5, evidence_quality: 5,
        conversion_likelihood: 3
      },
      recommended_tier: 'Growth ($299/mo or $2,990/yr)',
      expected_objection: 'We already have our own revenue team and do not buy from cold intros.',
      objection_response: 'It is a 30-minute live demo, not a pitch. No contract or invoice before evidence.',
      next_action: 'Founder-approved warm intro via LinkedIn (founder channel), then a 30-minute live demo.'
    },
    outreach: {
      to: 'hello@bosta.co',
      subject: 'Bosta B2B heavy-transport — a governed revenue engine (30-min demo)',
      body: [
        'Hello Mohamed,',
        '',
        "I'm the founder of Elmahrosa International. We build TEOS DealMaker — the AI Revenue Operating System that runs a governed workforce for B2B sales.",
        '',
        "I read about Bosta's expansion: $32M round, 80M parcels target for 2026, and a new B2B heavy-transport motion. That new motion needs pipeline — fast.",
        '',
        'DealMaker runs 24/7: research, prospecting, outreach, and follow-up — with every message governed and nothing sent without human approval.',
        '',
        "For Bosta, we'd start with a 30-minute live demo — your team watches the workforce run a real B2B outreach mission. You keep full control. No commitment.",
        '',
        'Would next week work?',
        '',
        'Elmahrosa'
      ].join('\n')
    }
  },
  {
    company_name: 'PushBots, Inc.',
    person_name: null,
    website: 'https://pushbots.com',
    source: 'PUBLIC_RESEARCH',
    category: 'B2B SaaS',
    offer: 'Go-to-market capacity for the AI email platform with an Egypt-hiring Sales Manager',
    pain_point: 'Actively hiring a SaaS Sales Manager (Egypt, remote) — an open pipeline capacity need.',
    contact_email: null,
    status: 'ACTIVE',
    stage: 'review',
    metadata: {
      country: 'Global / Egypt (remote)',
      geo_region: 'GLOBAL',
      buyer_role: 'Hiring Manager (not identified)',
      funding: 'VC-backed (Tamar Venture Partners)',
      urgency_estimate: 'MEDIUM — active hiring signals for pipeline capacity',
      evidence: [
        {
          source: 'startup.jobs listing',
          summary: 'Open "SaaS Sales Manager — Egypt (Remote)" role; push notification marketing platform for mobile/web apps.'
        }
      ],
      dimensions: {
        icp_fit: 5, revenue_pain: 3, urgency: 4, company_maturity: 3,
        buyer_authority: 2, budget_potential: 3, tech_ai_fit: 4,
        governance_security_fit: 3, geo_priority: 2, evidence_quality: 3,
        conversion_likelihood: 3
      },
      recommended_tier: 'Growth ($299/mo or $2,990/yr)',
      expected_objection: 'Cold outreach to an unnamed hiring manager will not reach the decision maker.',
      objection_response: 'Queue for the founder-led channel; no email drafted until the decision maker is identified.',
      next_action: 'Identify the hiring manager, then route through the founder-led intro channel.'
    },
    outreach: null
  }
];

function ttlMs() {
  const hours = Number(process.env.SOR_APPROVAL_TTL_HOURS);
  if (Number.isFinite(hours) && hours > 0) return hours * 60 * 60 * 1000;
  return DEFAULT_TTL_MS;
}

function baseUrl() {
  return process.env.SITE_URL || product.siteUrl || 'https://dealmaker.elmahrosa.org';
}

function approvalUrl(emailId) {
  return `${baseUrl()}/approvals/customer0?id=${encodeURIComponent(emailId)}`;
}

function draftHash(email) {
  return crypto.createHash('sha256').update(`${email.subject || ''}\n${email.body || ''}`).digest('hex').slice(0, 16);
}

function reposOf(db) {
  if (db && db.repos) return db.repos;
  return require('../../db/repos').createRepos(db.adapter);
}

async function founderWorkspace(db) {
  return db.adapter.findOne('workspaces', { slug: founderSeed.FOUNDER_WORKSPACE_SLUG });
}

function requestedAt(email) {
  return email.requested_at || email.created_at || null;
}

function isExpired(email) {
  const ts = requestedAt(email);
  if (!ts) return false;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t > ttlMs();
}

async function prospectFor(db, email) {
  const m = /^customer0:prospect_(\d+)$/.exec(String(email.campaign || ''));
  if (!m) return null;
  const r = reposOf(db);
  return r.prospects.get(Number(m[1]));
}

function audit(repos, email, actionType, status, details) {
  const safe = Object.assign(
    {
      mission: MISSION,
      email_id: email && email.id != null ? email.id : null,
      campaign: email && email.campaign ? email.campaign : null
    },
    details || {}
  );
  try {
    repos.audit.add({
      workspace_id: email && email.workspace_id ? email.workspace_id : null,
      agent_name: MISSION,
      action_type: actionType,
      details: safe
    });
  } catch (err) {
    console.error('[customer0] audit trail write failed:', err.message);
  }
  try {
    writeEntry(actionType, email && email.id != null ? String(email.id) : MISSION, status, safe);
  } catch (err) {
    console.error('[customer0] audit vault write failed:', err.message);
  }
}

function toReviewItem(email, prospect) {
  const expiresAt = requestedAt(email);
  return {
    id: email.id,
    company: prospect ? prospect.company_name : null,
    prospect_id: prospect ? prospect.id : null,
    country: prospect && prospect.metadata ? prospect.metadata.country : null,
    buyer: prospect ? prospect.person_name : null,
    buyer_role: prospect && prospect.metadata ? prospect.metadata.buyer_role : null,
    website: prospect ? prospect.website : null,
    evidence: prospect && prospect.metadata && prospect.metadata.evidence ? prospect.metadata.evidence : null,
    pain_hypothesis: prospect ? prospect.pain_point : null,
    tier: prospect && prospect.metadata ? prospect.metadata.recommended_tier : null,
    channel: 'email',
    to: email.to_email,
    from: email.from_email,
    subject: email.subject,
    body: email.body,
    objective: 'Book a 30-minute live demonstration; convert to a paid Growth tier trial.',
    campaign: email.campaign,
    status: email.approved_at ? 'APPROVED' : email.status,
    draft_version: 'v1',
    draft_hash: draftHash(email),
    requested_at: requestedAt(email),
    expires_at: expiresAt ? new Date(new Date(expiresAt).getTime() + ttlMs()).toISOString() : null,
    expired: isExpired(email),
    links: {
      review: approvalUrl(email.id),
      approve: `${approvalUrl(email.id)}&action=approve`,
      reject: `${approvalUrl(email.id)}&action=reject`
    },
    expected_outcome: 'qualified sales opportunity or explicit pass'
  };
}

async function pendingOutreach(db, opts) {
  const o = opts || {};
  const r = reposOf(db);
  const ws = await founderWorkspace(db);
  if (!ws) return [];
  const emails = await r.outboundEmails.list(ws.id, {
    status: o.status || 'PENDING_APPROVAL',
    orderBy: 'id',
    order: 'asc',
    limit: o.limit || 200
  });
  const out = [];
  for (const email of emails) {
    if (!String(email.campaign || '').startsWith(CAMPAIGN_PREFIX)) continue;
    const prospect = await prospectFor(db, email);
    out.push(toReviewItem(email, prospect));
  }
  return out;
}

function alreadyDecided(email) {
  if (email.status === 'REJECTED') return { status: 'REJECTED' };
  if (email.approved_at && (email.status === 'PENDING_APPROVAL' || email.status === 'APPROVED')) {
    return { status: 'APPROVED' };
  }
  return null;
}

async function decide(db, opts) {
  const o = opts || {};
  const decision = String(o.decision || '').toLowerCase();
  if (decision !== 'approve' && decision !== 'reject') {
    return { ok: false, error: 'invalid_decision' };
  }
  const r = reposOf(db);
  const ws = await founderWorkspace(db);
  if (!ws) return { ok: false, error: 'founder_workspace_missing' };
  const email = await r.outboundEmails.get(ws.id, Number(o.id));
  if (!email) return { ok: false, error: 'not_found', email_id: o.id };
  if (!String(email.campaign || '').startsWith(CAMPAIGN_PREFIX)) {
    return { ok: false, error: 'not_found', email_id: o.id };
  }
  const prospect = await prospectFor(db, email);
  const person = o.founder ? (o.founder.email || `founder#${o.founder.id}`) : 'founder';
  const nowIso = new Date().toISOString();
  const baseDetails = {
    mission: MISSION,
    email_id: email.id,
    prospect_id: prospect ? prospect.id : null,
    campaign: email.campaign,
    channel: 'email',
    subject: email.subject,
    draft_hash: draftHash(email),
    requested_at: requestedAt(email),
    decision,
    decided_by: person,
    decided_at: nowIso
  };

  const prior = alreadyDecided(email);
  if (prior) {
    audit(r, email, 'CUSTOMER0_OUTREACH_DUPLICATE', 'DUPLICATE', Object.assign({}, baseDetails, { prior_status: prior.status }));
    return { ok: false, error: 'already_decided', email_id: email.id, status: prior.status };
  }
  if (email.status !== 'PENDING_APPROVAL') {
    return { ok: false, error: 'wrong_state', email_id: email.id, state: email.status };
  }
  if (isExpired(email)) {
    const denied = await channel().reject(r, ws.id, email.id, { rejected_by: 'system', reason: 'expired' });
    audit(r, email, 'CUSTOMER0_OUTREACH_EXPIRED', 'EXPIRED', Object.assign({}, baseDetails, { state_after: denied.ok ? 'REJECTED' : email.status }));
    return { ok: false, error: 'expired', email_id: email.id };
  }

  if (decision === 'approve') {
    const res = await channel().approve(r, ws.id, email.id, { approved_by: person });
    if (!res.ok) {
      if (res.error === 'invalid_state') {
        return { ok: false, error: 'already_decided', email_id: email.id };
      }
      return { ok: false, error: res.error || 'approval_failed', email_id: email.id };
    }
    audit(r, email, 'CUSTOMER0_OUTREACH_APPROVED', 'APPROVED', baseDetails);
    let enqueue = null;
    try {
      const worker = require('../outboundWorker');
      const q = await worker.enqueue(db.adapter, {
        workspace_id: ws.id,
        recipient: email.to_email,
        from_email: email.from_email,
        subject: email.subject,
        body: email.body,
        approved_by: person,
        approved_at: nowIso
      });
      enqueue = q && q.ok ? { ok: true, job_id: q.job && q.job.id } : { ok: false, error: q && q.error ? q.error : 'enqueue_denied' };
    } catch (err) {
      enqueue = { ok: false, error: 'enqueue_failed', message: err.message };
    }
    audit(r, email, 'CUSTOMER0_OUTREACH_ENQUEUE', enqueue.ok ? 'QUEUED' : 'BLOCKED', Object.assign({}, baseDetails, { enqueue }));
    return { ok: true, status: 'approved', email_id: email.id, enqueue };
  }

  const res = await channel().reject(r, ws.id, email.id, { rejected_by: person, reason: o.reason || 'founder_rejected' });
  if (!res.ok) {
    if (res.error === 'invalid_state') {
      return { ok: false, error: 'already_decided', email_id: email.id };
    }
    return { ok: false, error: res.error || 'rejection_failed', email_id: email.id };
  }
  audit(r, email, 'CUSTOMER0_OUTREACH_REJECTED', 'REJECTED', Object.assign({}, baseDetails, { reason: o.reason || null }));
  return { ok: true, status: 'rejected', email_id: email.id };
}

async function batchDecide(db, opts) {
  const o = opts || {};
  const ids = Array.isArray(o.ids) ? o.ids : [];
  const results = [];
  let decided = 0;
  let skipped = 0;
  for (const id of ids) {
    const res = await decide(db, { id, decision: o.decision, founder: o.founder, reason: o.reason });
    results.push(res);
    if (res.ok) decided += 1;
    else skipped += 1;
  }
  return { ok: true, decided, skipped, results };
}

async function seed(db, opts) {
  const o = opts || {};
  const fid = process.env.TEOS_FOUNDER_TELEGRAM_ID;
  if (!fid) return { seeded: false, reason: 'no_founder_configured' };
  const fs = await founderSeed.ensureFounderWorkspace(db.adapter);
  const ws = fs && fs.workspace ? fs.workspace : await founderWorkspace(db);
  if (!ws) return { seeded: false, reason: 'founder_workspace_missing' };
  const r = reposOf(db);
  const ch = channel();
  const createdProspects = [];
  const createdEmails = [];
  let skip = 0;

  for (const c of CUSTOMER0_SEED_PROSPECTS) {
    let prospect = await db.adapter.findOne('prospects', { company_name: c.company_name });
    const card = scoreProspect(c);
    const data = {
      company_name: c.company_name,
      person_name: c.person_name,
      website: c.website,
      source: c.source,
      category: c.category,
      offer: c.offer,
      pain_point: c.pain_point,
      contact_email: c.contact_email,
      status: c.status,
      stage: c.stage,
      score: card.score,
      score_reason: card.reasons.join('; '),
      score_source: 'customer0_scorecard',
      score_timestamp: new Date().toISOString(),
      sentinel_verdict: card.sentinel_verdict,
      metadata: c.metadata,
      next_action: c.metadata && c.metadata.next_action
    };
    if (!prospect) {
      prospect = await r.prospects.create(data);
      createdProspects.push(prospect);
    } else if (o.force) {
      prospect = await r.prospects.update(prospect.id, data);
    } else {
      skip += 1;
    }

    if (c.outreach) {
      const existingEmail = await db.adapter.findOne('outbound_emails', {
        to_email: c.outreach.to,
        subject: c.outreach.subject
      });
      let email = existingEmail;
      if (!email) {
        const draft = await ch.createDraft(r, {
          workspace_id: ws.id,
          to: c.outreach.to,
          from: EMAIL_FROM,
          subject: c.outreach.subject,
          body: c.outreach.body,
          campaign: `${CAMPAIGN_PREFIX}${prospect.id}`
        });
        email = draft && draft.ok ? draft.email : null;
        createdEmails.push(email);
      } else if (o.force) {
        await r.outboundEmails.update(ws.id, email.id, {
          subject: c.outreach.subject,
          body: c.outreach.body,
          campaign: `${CAMPAIGN_PREFIX}${prospect.id}`,
          status: 'DRAFT'
        });
        email = await r.outboundEmails.get(ws.id, email.id);
      }
      if (email && email.status === 'DRAFT') {
        const req = await ch.requestApproval(r, ws.id, email.id, { reason: 'customer0 outreach' });
        if (req && req.ok) email = req.email;
      }
    }
  }

  return {
    seeded: true,
    createdProspects: createdProspects.length,
    createdEmails: createdEmails.length,
    existing: skip,
    note: 'Nothing was sent. All outreach drafts are governed: PENDING_APPROVAL until the founder approves through the authenticated surface, and the outbound worker is paused.'
  };
}

function channel() {
  return createEmailChannel();
}

async function fingerprint(db) {
  const r = reposOf(db);
  const ws = await founderWorkspace(db);
  const prospects = ws
    ? await r.prospects.list({ orderBy: 'id', order: 'asc', limit: 5000 })
    : [];
  const queue = await pendingOutreach(db, { limit: 2000 });
  const h = crypto.createHash('sha256');
  h.update(prospects.map(p => `${p.id}:${p.score}:${p.stage}`).join('|'));
  h.update('::');
  h.update(queue.map(q => `${q.id}:${q.status}:${q.expired ? 'E' : 'O'}`).join('|'));
  return h.digest('hex').slice(0, 32);
}

async function lastFingerprint(db) {
  const r = reposOf(db);
  const rows = await r.founderReports.list({ orderBy: 'id', order: 'desc', limit: 1 });
  const last = rows && rows[0];
  return last && last.metrics && last.metrics.customer0 ? last.metrics.customer0.fingerprint : null;
}

function cardFor(prospect) {
  if (prospect && prospect.metadata && prospect.metadata.dimensions) {
    return scoreProspect(prospect);
  }
  const score = Number(prospect && prospect.score) || 0;
  return {
    score,
    priority: score >= 70 ? 'A' : score >= 45 ? 'B' : 'C',
    sentinel_verdict: (prospect && prospect.sentinel_verdict) || (score >= 70 ? 'APPROVE' : score >= 45 ? 'REVIEW' : 'HOLD'),
    dimensions: {},
    reasons: []
  };
}

async function buildReportSection(db, metrics) {
  const r = reposOf(db);
  const ws = await founderWorkspace(db);
  const m = metrics || {};
  let prospects = [];
  if (ws) {
    prospects = await r.prospects.list({ orderBy: 'score', order: 'desc', limit: 200 });
  }
  const scored = prospects.map(p => ({ prospect: p, card: cardFor(p) }));
  const top = scored[0] || null;
  const runnerUp = scored[1] || null;

  const queue = await pendingOutreach(db, { limit: 200 });
  const pendingApprovals = queue.filter(q => q.status === 'PENDING_APPROVAL' && !q.expired).length;

  let sor = { enabled: false, mode: 'STOPPED' };
  try {
    sor.enabled = Boolean(require('../../db').isSorEnabled());
    const modeRow = await r.revenueOps.get(KEY_MODE);
    sor.mode = (modeRow && modeRow.value) || sor.configMode || 'STOPPED';
  } catch (_err) {
    sor = { enabled: false, mode: 'STOPPED' };
  }
  try {
    const cfg = sorConfig();
    sor.enabled = Boolean(cfg.enabled);
  } catch (_err) {
    // keep defaults
  }

  const fp = await fingerprint(db);
  const lastFp = await lastFingerprint(db);
  const changed = !lastFp || lastFp !== fp;

  const objections = top && top.prospect.metadata && top.prospect.metadata.expected_objection
    ? [{ company: top.prospect.company_name, objection: top.prospect.metadata.expected_objection, response: top.prospect.metadata.objection_response }]
    : [];

  const nextAction = pendingApprovals > 0
    ? `Founder decision required: ${pendingApprovals} governed outreach approval(s) pending.`
    : top
      ? `Next discovery window: top opportunity "${top.prospect.company_name}" — advance via founder-led intro (${top.prospect.next_action || 'review pending'}).`
      : 'Seed Customer #0 prospects (scripts/seed-customer0.js) to start the loop.';

  return {
    missionStatus: sor.enabled && sor.mode !== 'STOPPED' ? 'RUNNING' : 'PAUSED',
    changed,
    fingerprint: fp,
    topOpportunity: top ? {
      company: top.prospect.company_name,
      score: top.card.score,
      priority: top.card.priority,
      sentinel_verdict: top.card.sentinel_verdict,
      buyer: top.prospect.person_name,
      buyer_role: top.prospect.metadata && top.prospect.metadata.buyer_role,
      country: top.prospect.metadata && top.prospect.metadata.country,
      website: top.prospect.website,
      evidence: top.prospect.metadata && top.prospect.metadata.evidence,
      pain: top.prospect.pain_point,
      offer: top.prospect.offer,
      tier: top.prospect.metadata && top.prospect.metadata.recommended_tier,
      reasons: top.card.reasons
    } : null,
    runnerUp: runnerUp ? { company: runnerUp.prospect.company_name, score: runnerUp.card.score, priority: runnerUp.card.priority } : null,
    objections,
    outreachQueue: queue,
    pendingApprovals,
    revenueProgress: {
      mrr: Number(m.mrr) || 0,
      payingAccounts: Number(m.payingAccounts) || 0
    },
    nextAction,
    sent: Number(m.sent) || 0,
    replied: Number(m.replied) || 0,
    deadline: null,
    guard: m.guard || 'FOUNDER'
  };
}

function renderCustomer0Text(section) {
  const s = section || {};
  const lines = [];
  lines.push('──────────────────────────────────────────');
  lines.push('CUSTOMER #0 · TEOS DealMaker sells to DealMaker');
  lines.push(`TIMESTAMP: ${new Date().toISOString()}`);
  lines.push(`Mission status: ${s.missionStatus}`);
  if (!s.changed) {
    lines.push('NO MATERIAL CHANGE — no new prospects, decisions, or status moves since the last report.');
  }
  lines.push('');
  lines.push('Top opportunity (scorecard):');
  if (s.topOpportunity) {
    const t = s.topOpportunity;
    lines.push(`  ${t.company} — score ${t.score}/100, priority ${t.priority}, Sentinel: ${t.sentinel_verdict}`);
    lines.push(`  Buyer: ${t.buyer || 'not identified'} (${t.buyer_role || 'role unknown'}) · ${t.country || ''}`);
    if (t.evidence && t.evidence.length) {
      lines.push(`  Evidence: ${t.evidence.map(e => `${e.source}: ${e.summary}`).join(' ')}`);
    }
    lines.push(`  Pain: ${t.pain || 'not stated'}`);
    lines.push(`  Offer: ${t.offer || ''}`);
    lines.push(`  Recommended tier: ${t.tier || '—'}`);
    if (s.runnerUp) lines.push(`  Runner-up: ${s.runnerUp.company} (score ${s.runnerUp.score}, priority ${s.runnerUp.priority})`);
  } else {
    lines.push('  (none yet — seed prospects)');
  }
  if (s.objections && s.objections.length) {
    lines.push('');
    lines.push('Objections (pre-empted):');
    for (const ob of s.objections) {
      lines.push(`  [${ob.company}] ${ob.objection}`);
      lines.push(`    → ${ob.response}`);
    }
  }
  lines.push('');
  lines.push('Outreach (governed queue):');
  if (s.outreachQueue && s.outreachQueue.length) {
    for (const q of s.outreachQueue) {
      lines.push(`  [${q.status}${q.expired ? '/EXPIRED' : ''}] #${q.id} ${q.company || q.to} — ${q.subject}`);
      lines.push(`    Channel: ${q.channel} · To: ${q.to} · Objective: ${q.objective}`);
      if (q.requested_at) lines.push(`    Requested: ${q.requested_at} · Expires: ${q.expires_at}`);
      lines.push(`    Review/decide: ${q.links.review}`);
    }
  } else {
    lines.push('  (no pending outreach)');
  }
  lines.push('');
  lines.push('Revenue progress:');
  lines.push(`  MRR (active, non-free): ${s.revenueProgress ? s.revenueProgress.mrr : 0}`);
  lines.push(`  Paying accounts: ${s.revenueProgress ? s.revenueProgress.payingAccounts : 0}`);
  lines.push('');
  lines.push(`Next action: ${s.nextAction}`);
  lines.push('');
  lines.push('Loop: DISCOVER → QUALIFY → FOUNDER APPROVAL → CONSEQUENTIAL ACTION (send). Nothing is sent without approval.');
  return lines.join('\n');
}

async function latestReport(db) {
  const r = reposOf(db);
  const rows = await r.founderReports.list({ orderBy: 'id', order: 'desc', limit: 1 });
  const last = rows && rows[0];
  if (!last) return null;
  return {
    report_id: last.report_id,
    subject: last.subject,
    period_label: last.period_label,
    delivery_status: last.delivery_status,
    generated_at: last.generated_at,
    metrics: last.metrics || null
  };
}

module.exports = {
  MISSION,
  CAMPAIGN_PREFIX,
  CUSTOMER0_SEED_PROSPECTS,
  ttlMs,
  baseUrl,
  approvalUrl,
  draftHash,
  isExpired,
  pendingOutreach,
  decide,
  batchDecide,
  seed,
  buildReportSection,
  renderCustomer0Text,
  fingerprint,
  latestReport,
  _channel: channel
};
