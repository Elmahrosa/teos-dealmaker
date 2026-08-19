const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();
const express = require('express');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const audit = require('../utils/auditLogger');
const { getMode } = require('../config/mode');
const billing = require('../services/billing');
const auth = require('../services/auth');
const sessionService = require('../services/session');
const identity = require('../services/identity');
const render = require('./render');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

// Audit access is fail-closed: the endpoint returns 503 until AUDIT_API_KEY is
// configured, and every request must present a matching X-API-Key header.
// This keeps the sensitive audit trail out of the public marketing surface.
function requireAuditAuth(req, res, next) {
  const key = process.env.AUDIT_API_KEY;
  if (!key) return res.status(503).json({ error: 'audit_endpoint_not_configured' });
  const provided = req.get('x-api-key') || '';
  if (provided.length !== key.length) return res.status(401).json({ error: 'unauthorized' });
  const ok = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(key));
  if (!ok) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function contentSecurityPolicy() {
  const scriptSrc = ['\'self\'', '\'unsafe-inline\''];
  if (process.env.ANALYTICS_GA4) scriptSrc.push('https://www.googletagmanager.com');
  if (process.env.ANALYTICS_CLARITY) scriptSrc.push('https://www.clarity.ms');
  if (process.env.ANALYTICS_LINKEDIN) scriptSrc.push('https://snap.licdn.com');
  if (process.env.ANALYTICS_META_PIXEL) scriptSrc.push('https://connect.facebook.net');
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self' https:"
  ].join('; ');
}

// Trust exactly one reverse proxy by default (rate limiters rely on it).
// Set TRUST_PROXY to the number of hops in front of the app (e.g. "0" if the
// server is directly exposed, "2" behind two proxies).
const trustProxy = process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : 1;
app.set('trust proxy', Number.isFinite(trustProxy) ? trustProxy : 1);

app.use('/api/', apiLimiter);
app.use('/webhook/', webhookLimiter);

const publicDashboard = path.join(__dirname, '..', 'public', 'dashboard');
app.use('/dashboard', (req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});
app.use('/dashboard', express.static(publicDashboard));

const publicFounder = path.join(__dirname, '..', 'public', 'founder');
app.use('/founder', (req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});
app.use('/founder', requireAuditAuth, express.static(publicFounder));

// 24/7 Sales Engine control panel — served from the founder directory, same
// audit-key gate. The page communicates with /api/founder/sales-loop/* via
// the founder session (Bearer token).
app.get('/founder/sales-loop', requireAuditAuth, (req, res) => {
  res.sendFile(path.join(publicFounder, 'sales-loop.html'));
});

app.use((req, res, next) => {
  res.set({
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    'Content-Security-Policy': contentSecurityPolicy()
  });
  next();
});

function cacheImmutable(req, res, next) {
  res.set('Cache-Control', 'public, max-age=604800, immutable');
  next();
}

app.get('/api/pricing', (req, res) => {
  res.json({ tiers: render.PRICING, addons: render.PRICING.ADDONS });
});

// Authentication endpoints
app.post('/api/auth/signup', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }
    const result = await auth.signup(adapter, req.body || {});
    // Remove sensitive data before sending response
    const { password_hash, salt, ...safeUser } = result.user || {}; // eslint-disable-line no-unused-vars
    res.status(201).json({
      ok: true,
      user: safeUser,
      workspace: result.workspace,
      subscription: result.subscription
    });
  } catch (err) {
    console.error('[auth] signup error:', err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/auth/login', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }
    const result = await auth.login(adapter, req.body || {});
    const session = await sessionService.createSession(adapter, result.user.id);
    res.json({
      ok: true,
      user: result.user,
      sessionToken: session.token
    });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    res.status(401).json({ ok: false, error: 'Invalid email or password' });
  }
});

// Web founder login - returns session info for founder dashboard access
app.post('/api/auth/web-login', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }

    // First, perform regular login
    const loginResult = await auth.login(adapter, req.body || {});
    const userId = loginResult.user.id;

    // Founder access is a single deterministic gate: the user whose id matches
    // TEOS_FOUNDER_TELEGRAM_ID. Workspace member roles are not trusted here.
    const isFounder = await identity.isFounderUser(adapter, userId);
    if (!isFounder) {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden: Founder access required'
      });
    }

    // Issue a real server-side session (SHA-256 hash at rest, expiring,
    // revocable via /api/auth/logout). The raw token is returned once.
    const session = await sessionService.createSession(adapter, userId);
    res.json({
      ok: true,
      user: loginResult.user,
      isFounder: true,
      sessionToken: session.token
    });
  } catch (err) {
    console.error('[auth] web-login error:', err.message);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// Founder-gated sessions for the Command Center and admin surfaces. Requires a
// real founder session issued by /api/auth/web-login (Bearer token). The old
// placeholder that accepted any non-empty ≥32-char value in x-founder-session
// or ?session= is removed: a forged header is now rejected with 401/403.
const checkFounderSession = sessionService.requireFounderSession;

// Entitlement check endpoint. Identity comes from the validated session, never
// from a client-supplied header — x-user-id is no longer trusted.
app.get('/api/auth/entitlement', sessionService.requireSession, async (req, res) => {
  try {
    const userId = req.authUser.id;
    const entitled = await auth.checkUserEntitlement(req.adapter, userId);
    res.json({
      ok: true,
      entitled
    });
  } catch (err) {
    console.error('[auth] entitlement check error:', err.message);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// Increment mission usage endpoint. Identity comes from the validated session;
// the x-user-id header is ignored.
app.post('/api/auth/missions/increment', sessionService.requireSession, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const increment = req.body && req.body.increment ? parseInt(req.body.increment) : 1;
    if (isNaN(increment) || increment < 1) {
      return res.status(400).json({ ok: false, error: 'Valid increment required' });
    }
    const result = await auth.incrementUserMissionUsage(req.adapter, req.authUser.id, increment);
    res.json({
      ok: true,
      subscription: result
    });
  } catch (err) {
    console.error('[auth] mission increment error:', err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Logout: revokes the presented session token server-side.
app.post('/api/auth/logout', sessionService.requireSession, async (req, res) => {
  try {
    await sessionService.revokeSession(req.adapter, req.sessionToken);
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth] logout error:', err.message);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

app.get('/api/health', (req, res) => {
  const totalEntries = audit.countEntries();
  // Execution modes are founder-only. Public consoles see a neutral
  // operational status, never the DRY/LIVE mode.
  const mode = getMode() === 'LIVE' ? 'live' : 'operational';
  res.json({
    status: 'ok',
    mode,
    totalEntries,
    timestamp: new Date().toISOString()
  });
});

// Plain uptime check used by deployment verification and external monitors.
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TEOS DealMaker',
    timestamp: new Date().toISOString()
  });
});

// Founder-only deployment configuration verification. Reports existence only —
// never prints secret values, never exposes tokens or keys.
app.get('/api/deploy-verify', requireAuditAuth, (req, res) => {
  const has = name => process.env[name] !== undefined && process.env[name] !== '';
  const result = {
    ok: true,
    mode: has('TEOS_MODE') ? (getMode() === 'LIVE' ? 'LIVE' : 'operational') : 'UNSET',
    config: {
      TEOS_MODE: has('TEOS_MODE'),
      DATABASE_URL: has('DATABASE_URL'),
      AUDIT_API_KEY: has('AUDIT_API_KEY'),
      DODO_API_KEY: has('DODO_API_KEY'),
      DODO_WEBHOOK_SECRET: has('DODO_WEBHOOK_SECRET'),
      RESEND_API_KEY: has('RESEND_API_KEY'),
      EMAIL_FROM: has('EMAIL_FROM'),
      FOUNDER_REPORT_TO: has('FOUNDER_REPORT_TO'),
      FOUNDER_REPORT_EMAIL: has('FOUNDER_REPORT_EMAIL'),
      SOR_ENABLED: has('SOR_ENABLED'),
      SOR_REPORT_INTERVAL_HOURS: has('SOR_REPORT_INTERVAL_HOURS'),
      RESEND_TIMEOUT_MS: has('RESEND_TIMEOUT_MS')
    },
    revenue_path: has('DODO_API_KEY') && has('DODO_WEBHOOK_SECRET') ? 'CONFIRMED' : 'NOT_CONFIRMED',
    outbound: has('RESEND_API_KEY') ? 'CONFIGURED' : 'BLOCKED',
    revenue_ops: has('SOR_ENABLED') ? (String(process.env.SOR_ENABLED).toLowerCase() === 'true' ? 'ENABLED' : 'DISABLED') : 'UNSET',
    timestamp: new Date().toISOString()
  };
  res.json(result);
});

app.get('/api/diagnostics', async (req, res) => {
  const out = { dbPingMs: null, dbWarmMs: null, helloMs: null, statusMs: null, error: null };
  try {
    const { getPool } = require('../db');
    const pool = getPool();
    const ping = Date.now();
    await pool.query('select 1');
    out.dbPingMs = Date.now() - ping;
    const warm = Date.now();
    await pool.query('select 1');
    out.dbWarmMs = Date.now() - warm;
  } catch (err) {
    out.error = 'db: ' + err.message;
    return res.json(out);
  }
  const founder = Number(process.env.TEOS_FOUNDER_TELEGRAM_ID || 0);
  if (founder) {
    try {
      const router = require('../services/router');
      const adapter = require('../db').getAdapter();
      const t1 = Date.now();
      await router.handleText(adapter, founder, 'hello');
      out.helloMs = Date.now() - t1;
      const t2 = Date.now();
      await router.handleText(adapter, founder, 'status');
      out.statusMs = Date.now() - t2;
    } catch (err) {
      out.error = (out.error ? out.error + '; ' : '') + 'router: ' + err.message;
    }
  }
  res.json(out);
});

app.get('/api/audit', requireAuditAuth, (req, res) => {
  const requested = parseInt(req.query.limit, 10);
  const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 100, 500);
  const entries = audit.readTail(limit);
  res.json(entries.reverse());
});

app.post('/webhook/dodo', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = req.body.toString('utf8');
  const signature = req.headers['x-dodo-signature'] || req.headers['x-webhook-signature'] || '';

  const verification = billing.verifySignature(rawBody, signature);
  if (!verification.ok) {
    console.warn('[webhook] Dodo signature verification failed');
    return res.status(401).json({ error: 'invalid_signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (_err) {
    console.warn('[webhook] malformed JSON body');
    return res.status(400).json({ error: 'invalid_json' });
  }

  const eventType = event.event_type || event.type || 'unknown';
  const data = event.data || event.payload || event;

  console.log('[webhook] Dodo event:', eventType);

  let result;
  try {
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }
    result = await billing.handleEvent(adapter, eventType, data);
  } catch (err) {
    console.error('[webhook] handler error:', err.message);
    return res.status(500).json({ error: 'handler_error' });
  }

  res.json({ ok: true, event: eventType, result });
});

app.get('/', (req, res) => {
  const template = fs.readFileSync(path.join(__dirname, 'landing.html'), 'utf8');
  res.type('html').send(render.renderLanding(template));
});

// ---------------------------------------------------------------------------
// One-shot mission intake funnel (/start). The landing CTA sends a customer
// here; a submission records a mission_intakes row (status 'received') via
// services/missionIntake.js. Recording an intake never claims execution —
// the mission plan still has to be approved under policy governance.
// Founder review is audit-gated (/api/intakes and /intakes).
// ---------------------------------------------------------------------------
app.get('/start', (_req, res) => {
  res.type('html').send(render.renderStart());
});

app.get('/start/thanks', async (req, res) => {
  const id = Number(req.query.id);
  if (!Number.isFinite(id)) return res.status(400).type('html').send('Bad request');
  try {
    const { getAdapter } = require('../db');
    const { createRepos } = require('../db/repos');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = require('../services/missionIntake').sharedAdapter();
    }
    const intake = await createRepos(adapter).intakes.get(id);
    if (!intake) return res.status(404).type('html').send('Mission intake not found');
    res.type('html').send(render.renderStartThanks(intake));
  } catch (err) {
    console.error('[intake] thanks render error:', err.message);
    res.status(500).type('html').send('Intake confirmation unavailable');
  }
});

app.post('/api/intake', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const missionIntake = require('../services/missionIntake');
    const normalized = missionIntake.normalize(req.body || {});
    if (!normalized.ok) {
      return res.status(400).json({ ok: false, error: 'validation_failed', fields: normalized.errors });
    }
    const { getAdapter } = require('../db');
    const { createRepos } = require('../db/repos');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = require('../services/missionIntake').sharedAdapter();
    }
    const row = await createRepos(adapter).intakes.create(normalized.row);
    console.log('[intake] mission intake #' + row.id + ' received: ' + row.title);
    res.status(202).json({ ok: true, intakeId: row.id, status: row.status, thanksUrl: '/start/thanks?id=' + row.id });
  } catch (err) {
    console.error('[intake] create error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Founder-only intake list (same key gate as /api/audit). Includes contact
// because the founder acts on the intake.
app.get('/api/intakes', requireAuditAuth, async (req, res) => {
  try {
    const { getAdapter } = require('../db');
    const { createRepos } = require('../db/repos');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = require('../services/missionIntake').sharedAdapter();
    }
    const rows = await createRepos(adapter).intakes.list();
    const requested = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 500) : 200;
    const list = rows.slice(-limit).reverse();
    res.json({ ok: true, count: list.length, intakes: list });
  } catch (err) {
    console.error('[intake] list error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Founder-only intake console.
app.get('/intakes', requireAuditAuth, async (req, res) => {
  try {
    const { getAdapter } = require('../db');
    const { createRepos } = require('../db/repos');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = require('../services/missionIntake').sharedAdapter();
    }
    const rows = await createRepos(adapter).intakes.list();
    res.type('html').send(render.renderIntakesAdmin(rows));
  } catch (err) {
    console.error('[intake] admin render error:', err.message);
    res.status(500).type('html').send('Intake console unavailable');
  }
});

// Public sanitized intake contact channel. Returns ONLY the channel type of
// the latest intake ('email' | 'telegram' | 'none') — never the raw contact
// value. The customer-facing dashboard renders this as a neutral status row
// so no customer contact data is exposed outside the audit-gated consoles.
app.get('/api/intakes/contact-channel', async (_req, res) => {
  try {
    const { getAdapter } = require('../db');
    const { createRepos } = require('../db/repos');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = require('../services/missionIntake').sharedAdapter();
    }
    const rows = await createRepos(adapter).intakes.list();
    if (!rows.length) return res.json({ ok: true, present: false, channel: 'none' });
    const { CONTACT_FALLBACK } = require('../services/missionIntake');
    const raw = String((rows[rows.length - 1].contact) || '');
    if (!raw || raw === CONTACT_FALLBACK) return res.json({ ok: true, present: true, channel: 'none' });
    const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
    res.json({ ok: true, present: true, channel: emailLike ? 'email' : 'telegram' });
  } catch (err) {
    console.error('[intake] contact-channel error:', err.message);
    res.status(503).json({ ok: false, error: 'intakes_unavailable' });
  }
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(render.robotsTxt());
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(render.sitemapXml());
});

app.get('/favicon.svg', cacheImmutable, (req, res) => {
  res.type('image/svg+xml').sendFile(path.join(__dirname, 'favicon.svg'));
});

app.get('/og-image.svg', cacheImmutable, (req, res) => {
  res.type('image/svg+xml').sendFile(path.join(__dirname, 'og-image.svg'));
});

app.get('/og-image.png', cacheImmutable, (req, res) => {
  res.type('image/png').sendFile(path.join(__dirname, 'og-image.png'));
});

app.get('/dashboard', (req, res) => {
  const dashboardPath = path.join(__dirname, '..', 'public', 'dashboard', 'index.html');
  if (fs.existsSync(dashboardPath)) {
    return res.sendFile(dashboardPath);
  }

  res.type('html').send(
    render.renderDashboard(
      fs.readFileSync(path.join(__dirname, 'sentinel.html'), 'utf8')
    )
  );
});

async function getFounderWorkspace(adapter) {
  const { createRepos } = require('../db/repos');
  const repos = createRepos(adapter);
  const ws = await adapter.findOne('workspaces', { slug: 'workspace_founder' });
  if (!ws) return null;
  const plan = (await repos.plans.list(ws.id))[0] || null;
  return { ws, plan };
}

app.get('/report/:planId', async (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  const planId = Number(req.params.planId);
  if (!Number.isFinite(planId)) return res.status(400).type('html').send('Bad request');
  try {
    const { getAdapter } = require('../db');
    const adapter = getAdapter();
    const report = await require('../services/missionReport').missionReport(adapter, null, planId);
    if (!report) return res.status(404).type('html').send('Mission report not found');
    const html = render.renderMissionReport(report);
    res.type('html').send(html);
  } catch (err) {
    console.error('[Sentinel] report render error:', err.message);
    res.status(500).type('html').send('Report unavailable');
  }
});

app.get('/customer-0', async (_req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  try {
    const { getAdapter } = require('../db');
    const adapter = getAdapter();
    const found = await getFounderWorkspace(adapter);
    if (!found || !found.plan) {
      return res.status(404).type('html').send('Customer #0 reference not provisioned on this instance');
    }
    const report = await require('../services/missionReport').missionReport(adapter, found.ws.id, found.plan.id);
    if (!report) return res.status(404).type('html').send('Customer #0 mission report not found');
    const html = render.renderCustomerZero(report);
    res.type('html').send(html);
  } catch (err) {
    console.error('[Sentinel] customer-0 render error:', err.message);
    res.status(500).type('html').send('Customer #0 dashboard unavailable');
  }
});

async function getLatestReport(adapter) {
  const { createRepos } = require('../db/repos');
  const repos = createRepos(adapter);
  const ws = await adapter.findOne('workspaces', { slug: 'workspace_founder' });
  if (!ws) return null;
  const plans = await repos.plans.list(ws.id);
  if (!plans.length) return null;
  plans.sort((a, b) => (b.id || 0) - (a.id || 0));
  return require('../services/missionReport').missionReport(adapter, ws.id, plans[0].id);
}

app.get('/reports', async (_req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  try {
    const { getAdapter } = require('../db');
    const adapter = getAdapter();
    const report = await getLatestReport(adapter);
    if (!report) return res.status(404).type('html').send('Mission report not found');
    res.type('html').send(render.renderMissionReport(report));
  } catch (err) {
    console.error('[Sentinel] reports render error:', err.message);
    res.status(500).type('html').send('Report unavailable');
  }
});

app.get('/api/reports/latest', async (_req, res) => {
  try {
    const { getAdapter } = require('../db');
    const adapter = getAdapter();
    const report = await getLatestReport(adapter);
    if (!report) return res.status(404).json({ error: 'report_not_found' });
    res.json({ ok: true, report });
  } catch (err) {
    console.error('[Sentinel] reports api error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Governed outbound email report surface. Fail-closed like /api/audit:
// requires AUDIT_API_KEY, returns sanitized records (never the message body,
// never any API key). Body content is excluded because a founder-approved
// email may still contain confidential deal material.
app.get('/api/emails', requireAuditAuth, async (_req, res) => {
  try {
    const { getAdapter } = require('../db');
    const { createRepos } = require('../db/repos');
    const adapter = getAdapter();
    const repos = createRepos(adapter);
    const requested = parseInt(_req.query.limit, 10);
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 500) : 100;
    const channel = require('../services/emailChannel').createEmailChannel();
    const rows = await repos.outboundEmails.listAll(limit);
    res.json({ ok: true, emails: rows.map(r => channel.toReport(r)) });
  } catch (err) {
    console.error('[emailChannel] emails api error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---------------------------------------------------------------------------
// Governed 24/7 outbound worker controls (services/outboundWorker).
// Fail-closed: sending requires a real RESEND_API_KEY, an approved message and
// service state RUNNING. Controls require the same admin key as /api/audit.
// ---------------------------------------------------------------------------
const worker = require('../services/outboundWorker');

// Public operational status. Never exposes any secret (no API keys, no bodies).
app.get('/api/outreach/status', async (_req, res) => {
  try {
    const { getAdapter } = require('../db');
    res.json(await worker.health(getAdapter()));
  } catch (err) {
    console.error('[outboundWorker] status error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Founder-gated queue view. Sanitized: job ids, statuses, provider ids,
// timestamps, recipient domains — never bodies, never full recipient addresses.
app.get('/api/outreach/queue', requireAuditAuth, async (req, res) => {
  try {
    const { getAdapter } = require('../db');
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json(await worker.queue(getAdapter(), limit));
  } catch (err) {
    console.error('[outboundWorker] queue error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/outreach/pause', requireAuditAuth, express.json(), async (req, res) => {
  try {
    const { getAdapter } = require('../db');
    const result = await worker.pause(getAdapter(), (req.body && req.body.by) || 'founder', req.body && req.body.reason);
    res.json(result);
  } catch (err) {
    console.error('[outboundWorker] pause error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/outreach/resume', requireAuditAuth, express.json(), async (req, res) => {
  try {
    const { getAdapter } = require('../db');
    const result = await worker.resume(getAdapter(), (req.body && req.body.by) || 'founder');
    if (!result.ok) return res.status(result.error === 'outreach_not_enabled' ? 409 : 403).json(result);
    res.json(result);
  } catch (err) {
    console.error('[outboundWorker] resume error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/outreach/emergency-stop', requireAuditAuth, express.json(), async (req, res) => {
  try {
    const { getAdapter } = require('../db');
    const result = await worker.emergencyStop(getAdapter(), (req.body && req.body.by) || 'founder', req.body && req.body.reason);
    res.json(result);
  } catch (err) {
    console.error('[outboundWorker] emergency-stop error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Founder-controlled operational email report (destination: FOUNDER_REPORT_TO).
// Sends only on explicit founder action; never automatic. Fails closed without
// a configured destination or RESEND_API_KEY.
app.post('/api/outreach/founder-report', requireAuditAuth, express.json(), async (req, res) => {
  try {
    const { getAdapter } = require('../db');
    const result = await worker.sendFounderOpsReport(getAdapter(), (req.body && req.body.to) ? { to: req.body.to } : undefined);
    if (!result.ok) return res.status(result.reason === 'resend_not_configured' ? 503 : 400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[outboundWorker] founder-report error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

// 24/7 Revenue Operations — founder-controlled. Enabled only when the founder
// opts in via SOR_ENABLED=true. Automatic reports follow the configured window
// (default 3h); every delivery and mode change is audited. Fails closed when
// Resend or a founder destination is not configured.
const revenueOps = require('../services/revenueOps');

app.get('/api/revenue-ops/status', requireAuditAuth, async (_req, res) => {
  try {
    const { getAdapter } = require('../db');
    res.json(await revenueOps.status(getAdapter()));
  } catch (err) {
    console.error('[revenue-ops] status error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/revenue-ops/trigger', requireAuditAuth, express.json(), async (req, res) => {
  try {
    const { getAdapter } = require('../db');
    const result = await revenueOps.triggerNow(getAdapter(), (req.body && req.body.by) || 'founder');
    if (!result.ok) return res.status(result.reason === 'sor_disabled' ? 409 : 400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[revenue-ops] trigger error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/revenue-ops/pause', requireAuditAuth, express.json(), async (req, res) => {
  try {
    const { getAdapter } = require('../db');
    const result = await revenueOps.pause(getAdapter(), (req.body && req.body.by) || 'founder', (req.body && req.body.reason) || null);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[revenue-ops] pause error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/revenue-ops/resume', requireAuditAuth, express.json(), async (req, res) => {
  try {
    const { getAdapter } = require('../db');
    const result = await revenueOps.resume(getAdapter(), (req.body && req.body.by) || 'founder', (req.body && req.body.reason) || null, { acknowledgeEmergency: Boolean(req.body && req.body.acknowledgeEmergency) });
    if (!result.ok) return res.status(result.error === 'emergency_stop_env_active' || result.error === 'emergency_stopped' || result.error === 'sor_disabled' ? 409 : 403).json(result);
    res.json(result);
  } catch (err) {
    console.error('[revenue-ops] resume error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/revenue-ops/emergency-stop', requireAuditAuth, express.json(), async (req, res) => {
  try {
    const { getAdapter } = require('../db');
    const result = await revenueOps.emergencyStop(getAdapter(), (req.body && req.body.by) || 'founder', (req.body && req.body.reason) || null);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[revenue-ops] emergency-stop error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/revenue-ops/discover', requireAuditAuth, express.json(), async (req, res) => {
  try {
    const { getAdapter } = require('../db');
    const result = await revenueOps.discover(getAdapter(), (req.body && req.body.limit) ? { limit: req.body.limit } : {});
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[revenue-ops] discover error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/api/revenue-ops/approvals', requireAuditAuth, async (_req, res) => {
  try {
    const { getAdapter } = require('../db');
    res.json(await revenueOps.approvalSummary(getAdapter()));
  } catch (err) {
    console.error('[revenue-ops] approvals error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/revenue-ops/notify', requireAuditAuth, express.json(), async (req, res) => {
  try {
    const { getAdapter } = require('../db');
    const result = await revenueOps.notifyFounder(getAdapter(), (req.body && req.body.to) ? { to: req.body.to } : {});
    if (!result.ok) return res.status(result.reason === 'resend_not_configured' ? 503 : 400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[revenue-ops] notify error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Customer #0 (TEOS DealMaker sells to DealMaker) — governed review surface.
// The review pages are read-only and gated by the audit key. Decisions are
// POSTs gated by the founder session and go through the existing governed
// email lifecycle (services/emailChannel). Nothing sends from here.
app.get('/api/customer-0/report/latest', requireAuditAuth, async (_req, res) => {
  try {
    const customer0 = require('../services/customer0');
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }
    const report = await customer0.latestReport({ adapter });
    if (!report) return res.status(404).json({ ok: false, error: 'no_report_yet' });
    res.json({ ok: true, report });
  } catch (err) {
    console.error('[customer0] report error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/api/customer-0/approvals', requireAuditAuth, async (_req, res) => {
  try {
    const customer0 = require('../services/customer0');
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }
    const queue = await customer0.pendingOutreach({ adapter }, {});
    res.json({ ok: true, queue });
  } catch (err) {
    console.error('[customer0] approvals error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/customer-0/approvals/:id/approve', checkFounderSession, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const customer0 = require('../services/customer0');
    const result = await customer0.decide({ adapter: req.adapter }, {
      id: req.params.id,
      decision: 'approve',
      founder: req.authUser
    });
    if (!result.ok) {
      const code = result.error === 'not_found' ? 404 : result.error === 'already_decided' ? 409 : result.error === 'expired' ? 410 : 400;
      return res.status(code).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[customer0] approve error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/customer-0/approvals/:id/reject', checkFounderSession, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const customer0 = require('../services/customer0');
    const result = await customer0.decide({ adapter: req.adapter }, {
      id: req.params.id,
      decision: 'reject',
      founder: req.authUser,
      reason: req.body && req.body.reason ? req.body.reason : null
    });
    if (!result.ok) {
      const code = result.error === 'not_found' ? 404 : result.error === 'already_decided' ? 409 : result.error === 'expired' ? 410 : 400;
      return res.status(code).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[customer0] reject error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/customer-0/approvals/batch', checkFounderSession, express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const customer0 = require('../services/customer0');
    const body = req.body || {};
    if (!Array.isArray(body.ids) || !body.ids.length) {
      return res.status(400).json({ ok: false, error: 'ids_required' });
    }
    const result = await customer0.batchDecide({ adapter: req.adapter }, {
      ids: body.ids,
      decision: body.decision || 'approve',
      founder: req.authUser,
      reason: body.reason || null
    });
    res.json(result);
  } catch (err) {
    console.error('[customer0] batch error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---------------------------------------------------------------------------
// 24/7 Autonomous Sales Loop — Founder Command API. All routes require a
// validated founder session (Bearer token from /api/auth/web-login). The
// router handles DRY/LIVE mode switching, prospect discovery, auto-approval
// evaluation, follow-up escalation, pipeline health, and mission scheduler
// control. Every mutation is audit-logged.
// ---------------------------------------------------------------------------
const founderSalesLoop = require('./founderSalesLoop');
app.use('/api/founder/sales-loop', checkFounderSession, founderSalesLoop);

app.get('/approvals/customer0', requireAuditAuth, async (_req, res) => {
  try {
    const customer0 = require('../services/customer0');
    const render = require('./render');
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }
    const queue = await customer0.pendingOutreach({ adapter }, {});
    res.type('html').send(render.renderCustomer0ReviewPage(queue, {}));
  } catch (err) {
    console.error('[customer0] page error:', err.message);
    res.status(500).send('customer0 review page failed');
  }
});

// Resend webhooks: Svix-style signature verification, idempotent processing,
// provider events stored against the originating job. Bounces and complaints
// suppress the address until explicitly cleared by policy.
app.post('/webhook/resend', express.raw({ type: '*/*' }), async (req, res) => {
  const rawBody = req.body ? req.body.toString('utf8') : '';
  const verification = worker.verifyWebhookSignature(rawBody, req.headers || {});
  if (!verification.ok) {
    console.warn('[webhook] Resend signature verification failed:', verification.error);
    return res.status(verification.error === 'webhook_not_configured' ? 503 : 401).json({ error: verification.error });
  }
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (_err) {
    console.warn('[webhook] malformed JSON body');
    return res.status(400).json({ error: 'invalid_json' });
  }
  try {
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }
    const result = await worker.handleWebhook(adapter, event);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[webhook] Resend handler error:', err.message);
    res.status(500).json({ error: 'handler_error' });
  }
});

// Founder Command Center API - Protected by requireAuditAuth
// All endpoints are READ-ONLY in this phase

// Overview endpoint
app.get('/api/admin/command-center/overview', checkFounderSession, async (req, res) => {
  try {
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }

    const repos = require('../db/repos').createRepos(adapter);
    const { getMode } = require('../config/mode');

    // System info
    const mode = getMode();

    // Users stats
    const users = await repos.users.list();
    const usersWithWorkspace = await Promise.all(
      users.map(async (user) => {
        try {
          const workspace = await repos.workspaces.getByOwner(user.id);
          return workspace !== null;
        } catch (_) {
          return false;
        }
      })
    );
    const activeUsers = usersWithWorkspace.filter(Boolean).length;

    // Workspaces stats
    const workspaces = await repos.workspaces.list();
    const workspaceStats = {
      founder: 0,
      trial: 0,
      solo: 0,
      growth: 0,
      corporate: 0
    };

    for (const ws of workspaces) {
      const plan = ws.plan || 'solo';
      if (workspaceStats[plan] !== undefined) {
        workspaceStats[plan]++;
      }
    }

    // Missions stats
    const plans = await repos.plans.list();
    const missionStats = {
      total: plans.length,
      completed: 0,
      failed: 0,
      cancelled: 0
    };

    for (const plan of plans) {
      if (plan.status === 'completed') missionStats.completed++;
      else if (plan.status === 'failed') missionStats.failed++;
      else if (plan.status === 'cancelled') missionStats.cancelled++;
    }

    // Subscriptions stats
    const subscriptions = await repos.subscriptions.list();
    const subscriptionStats = {
      active: 0,
      inactive: 0,
      pending: 0,
      founder: 0,
      trial: 0,
      paid: 0
    };

    for (const sub of subscriptions) {
      if (sub.status === 'active') subscriptionStats.active++;
      else if (sub.status === 'cancelled' || sub.status === 'expired') subscriptionStats.inactive++;
      else if (sub.status === 'pending') subscriptionStats.pending++;

      // Count by plan
      const workspace = await repos.workspaces.get(sub.workspace_id);
      const plan = workspace ? workspace.plan : 'solo';
      if (plan === 'founder') subscriptionStats.founder++;
      else if (plan === 'trial') subscriptionStats.trial++;
      else if (plan === 'solo' || plan === 'growth' || plan === 'corporate') subscriptionStats.paid++;
    }

    // Revenue path status
    const hasDodoApiKey = process.env.DODO_API_KEY !== undefined && process.env.DODO_API_KEY !== '';
    const hasDodoWebhookSecret = process.env.DODO_WEBHOOK_SECRET !== undefined && process.env.DODO_WEBHOOK_SECRET !== '';
    const revenuePath = hasDodoApiKey && hasDodoWebhookSecret ? 'CONFIGURED' : 'NOT_CONFIGURED';

    // Product mapping check
    const starterMonthlyId = process.env.DODO_STARTER_MONTHLY_PID;
    const starterAnnualId = process.env.DODO_STARTER_ANNUAL_PID;
    const growthMonthlyId = process.env.DODO_GROWTH_MONTHLY_PID;
    const growthAnnualId = process.env.DODO_GROWTH_ANNUAL_PID;
    const businessMonthlyId = process.env.DODO_BUSINESS_MONTHLY_PID;
    const businessAnnualId = process.env.DODO_BUSINESS_ANNUAL_PID;

    const productMappingComplete = !!(
      starterMonthlyId && starterAnnualId &&
      growthMonthlyId && growthAnnualId &&
      businessMonthlyId && businessAnnualId
    );

    res.json({
      ok: true,
      system: {
        mode,
        health: 'operational', // Simplified - could check database connectivity etc.
        database: 'operational', // Simplified
        workforce: 'operational', // Simplified
        missionController: 'operational', // Simplified
        // Sentinel status would require checking if endpoint is configured
        sentinel: process.env.SENTINEL_ENDPOINT ? 'CONFIGURED' : 'NOT_CONFIGURED'
      },
      users: {
        total: users.length,
        active: activeUsers,
        withWorkspace: activeUsers
      },
      workspaces: {
        total: workspaces.length,
        ...workspaceStats
      },
      missions: missionStats,
      subscriptions: subscriptionStats,
      revenue: {
        dodoConfigured: hasDodoApiKey,
        webhookConfigured: hasDodoWebhookSecret,
        productMappingComplete: !!productMappingComplete,
        revenuePath
      }
    });
  } catch (err) {
    console.error('[Command Center] overview error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Users endpoint
app.get('/api/admin/command-center/users', checkFounderSession, async (req, res) => {
  try {
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }

    const repos = require('../db/repos').createRepos(adapter);
    const billing = require('../services/billing');

    const users = await repos.users.list();
    const userList = [];

    for (const user of users) {
      try {
        const workspace = await repos.workspaces.getByOwner(user.id);
        if (!workspace) {
          // User without workspace
          userList.push({
            id: user.id,
            displayName: user.display_name,
            email: user.email,
            telegramId: user.telegram_id || null,
            workspace: null,
            role: null,
            plan: null,
            subscriptionStatus: null,
            missionsUsed: 0,
            missionLimit: 0,
            entitlement: false,
            createdAt: user.created_at
          });
          continue;
        }

        const workspaceMembers = await repos.members.list(workspace.id);
        const member = workspaceMembers.find(m => m.user_id === user.id);
        const role = member ? member.role : 'owner';

        const subscription = await repos.subscriptions.get(workspace.id);
        const plan = workspace.plan || (subscription ? subscription.plan : 'solo');
        const missionLimit = billing.getMissionLimitForPlan(plan);
        const missionsUsed = subscription ? subscription.missions_used : 0;
        const entitled = await billing.isEntitled(adapter, workspace.id);

        userList.push({
          id: user.id,
          displayName: user.display_name,
          email: user.email,
          telegramId: user.telegram_id || null,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug
          },
          role,
          plan,
          subscriptionStatus: subscription ? subscription.status : null,
          missionsUsed,
          missionLimit: missionLimit === Infinity ? -1 : missionLimit, // -1 represents unlimited
          entitlement: !!entitled,
          createdAt: user.created_at
        });
      } catch (e) {
        // Skip user on error to prevent breaking the whole list
        console.warn('[Command Center] error processing user:', e.message);
        continue;
      }
    }

    res.json({ ok: true, users: userList });
  } catch (err) {
    console.error('[Command Center] users error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Workspaces endpoint
app.get('/api/admin/command-center/workspaces', checkFounderSession, async (req, res) => {
  try {
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }

    const repos = require('../db/repos').createRepos(adapter);
    const billing = require('../services/billing');

    const workspaces = await repos.workspaces.list();
    const workspaceList = [];

    // Helper function to determine validation status based on mission usage
    const getValidationStatus = (missionsUsed, missionLimit) => {
      // Unlimited plans (-1 represents Infinity)
      if (missionLimit <= 0) return 'OK';

      // Blocked when at or over limit
      if (missionsUsed >= missionLimit) return 'BLOCKED';

      // Warning when at or over 80% of limit
      if (missionsUsed >= missionLimit * 0.8) return 'WARNING';

      // Otherwise OK
      return 'OK';
    };

    for (const ws of workspaces) {
      try {
        const owner = await repos.users.getById(ws.owner_user_id);
        const subscription = await repos.subscriptions.get(ws.id);
        const plan = ws.plan || (subscription ? subscription.plan : 'solo');
        const missionLimit = billing.getMissionLimitForPlan(plan);
        const missionsUsed = subscription ? subscription.missions_used : 0;
        const entitled = await billing.isEntitled(adapter, ws.id);
        const validationStatus = getValidationStatus(missionsUsed, missionLimit === Infinity ? -1 : missionLimit);

        workspaceList.push({
          id: ws.id,
          name: ws.name,
          slug: ws.slug,
          owner: {
            id: owner.id,
            displayName: owner.display_name,
            email: owner.email,
            telegramId: owner.telegram_id || null
          },
          plan,
          subscriptionStatus: subscription ? subscription.status : null,
          missionsUsed,
          missionLimit: missionLimit === Infinity ? -1 : missionLimit,
          entitlement: !!entitled,
          validationStatus,
          cycle: subscription ? subscription.cycle : null,
          renewalDate: subscription ? subscription.renewal_date : null,
          providerCustomerId: subscription ? subscription.provider_customer_id : null,
          createdAt: ws.created_at
        });
      } catch (e) {
        console.warn('[Command Center] error processing workspace:', e.message);
        continue;
      }
    }

    res.json({ ok: true, workspaces: workspaceList });
  } catch (err) {
    console.error('[Command Center] workspaces error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Subscriptions endpoint
app.get('/api/admin/command-center/subscriptions', checkFounderSession, async (req, res) => {
  try {
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }

    const repos = require('../db/repos').createRepos(adapter);

    const subscriptions = await repos.subscriptions.list();
    const subscriptionList = [];

    // Helper function to determine validation status based on mission usage
    const getValidationStatus = (missionsUsed, missionLimit) => {
      // Unlimited plans (-1 represents Infinity)
      if (missionLimit <= 0) return 'OK';

      // Blocked when at or over limit
      if (missionsUsed >= missionLimit) return 'BLOCKED';

      // Warning when at or over 80% of limit
      if (missionsUsed >= missionLimit * 0.8) return 'WARNING';

      // Otherwise OK
      return 'OK';
    };

    for (const sub of subscriptions) {
      try {
        const workspace = await repos.workspaces.get(sub.workspace_id);
        const owner = workspace ? await repos.users.getById(workspace.owner_user_id) : null;
        const missionLimit = billing.getMissionLimitForPlan(sub.plan);
        const validationStatus = getValidationStatus(sub.missions_used, missionLimit === Infinity ? -1 : missionLimit);

        subscriptionList.push({
          id: sub.id,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug
          },
          owner: owner ? {
            id: owner.id,
            displayName: owner.display_name,
            email: owner.email
          } : null,
          plan: sub.plan,
          status: sub.status,
          missionsUsed: sub.missions_used,
          missionLimit: missionLimit === Infinity ? -1 : missionLimit,
          validationStatus,
          cycle: sub.cycle,
          renewalDate: sub.renewal_date,
          providerCustomerId: sub.provider_customer_id,
          createdAt: sub.created_at,
          updatedAt: sub.updated_at
        });
      } catch (e) {
        console.warn('[Command Center] error processing subscription:', e.message);
        continue;
      }
    }

    res.json({ ok: true, subscriptions: subscriptionList });
  } catch (err) {
    console.error('[Command Center] subscriptions error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Missions endpoint
app.get('/api/admin/command-center/missions', checkFounderSession, async (req, res) => {
  try {
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }

    const repos = require('../db/repos').createRepos(adapter);

    // Support query parameters for filtering
    const workspaceId = req.query.workspaceId ? parseInt(req.query.workspaceId, 10) : null;
    const status = req.query.status || null;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    let missions;
    if (workspaceId) {
      // Get missions for specific workspace
      const plans = await repos.plans.list(workspaceId);
      missions = [];
      for (const plan of plans) {
        if (!status || plan.status === status) {
          missions.push(plan);
        }
      }
    } else {
      // Get all missions
      missions = await repos.plans.list();
      if (status) {
        missions = missions.filter(m => m.status === status);
      }
    }

    // Apply pagination
    const paginated = missions.slice(offset, offset + limit);

    // Enrich with additional data
    const missionList = [];
    for (const mission of paginated) {
      try {
        const workspace = await repos.workspaces.get(mission.workspace_id);
        const owner = await repos.users.getById(workspace.owner_user_id);
        const steps = await repos.planSteps.list(mission.id);
        const completedSteps = steps.filter(s => s.status === 'completed').length;

        missionList.push({
          id: mission.id,
          title: mission.title,
          goal: mission.goal,
          status: mission.status,
          priority: mission.priority,
          archivedAt: mission.archived_at,
          isProtected: mission.is_protected,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug
          },
          owner: {
            id: owner.id,
            displayName: owner.display_name
          },
          totalSteps: steps.length,
          completedSteps,
          progress: steps.length ? Math.round((completedSteps / steps.length) * 100) : 0,
          createdAt: mission.created_at,
          updatedAt: mission.updated_at
        });
      } catch (e) {
        console.warn('[Command Center] error processing mission:', e.message);
        continue;
      }
    }

    res.json({
      ok: true,
      missions: missionList,
      pagination: {
        total: missions.length,
        limit,
        offset
      }
    });
  } catch (err) {
    console.error('[Command Center] missions error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Archive mission endpoint
app.post('/api/admin/command-center/missions/:id/archive', checkFounderSession, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const missionId = parseInt(req.params.id, 10);
    if (isNaN(missionId)) {
      return res.status(400).json({ ok: false, error: 'Invalid mission ID' });
    }

    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }

    const repos = require('../db/repos').createRepos(adapter);
    const audit = require('../utils/auditLogger');

    // Get the mission to check if it exists and if it's protected
    const mission = await repos.plans.get(missionId);
    if (!mission) {
      return res.status(404).json({ ok: false, error: 'Mission not found' });
    }

    // Check if mission is protected (cannot be archived)
    if (mission.is_protected) {
      return res.status(403).json({
        ok: false,
        error: 'Protected mission cannot be archived or deleted'
      });
    }

    // Check if mission is already archived
    if (mission.archived_at !== null) {
      return res.status(400).json({ ok: false, error: 'Mission is already archived' });
    }

    // Archive the mission (set archived_at to current timestamp)
    const archivedMission = await repos.plans.update(mission.workspace_id, missionId, {
      archived_at: new Date().toISOString()
    });

    // Audit the action
    await audit.log({
      adapter,
      action_type: 'MISSION_ARCHIVED',
      details: {
        missionId: missionId,
        missionTitle: mission.title,
        workspaceId: mission.workspace_id
      }
    });

    // Get updated workspace and owner info for response
    const workspace = await repos.workspaces.get(archivedMission.workspace_id);
    const owner = await repos.users.getById(workspace.owner_user_id);

    res.json({
      ok: true,
      mission: {
        id: archivedMission.id,
        title: archivedMission.title,
        goal: archivedMission.goal,
        status: archivedMission.status,
        priority: archivedMission.priority,
        archivedAt: archivedMission.archived_at,
        isProtected: archivedMission.is_protected,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug
        },
        owner: {
          id: owner.id,
          displayName: owner.display_name
        }
      }
    });
  } catch (err) {
    console.error('[Command Center] archive mission error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Unarchive mission endpoint
app.post('/api/admin/command-center/missions/:id/unarchive', checkFounderSession, express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const missionId = parseInt(req.params.id, 10);
    if (isNaN(missionId)) {
      return res.status(400).json({ ok: false, error: 'Invalid mission ID' });
    }

    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }

    const repos = require('../db/repos').createRepos(adapter);
    const audit = require('../utils/auditLogger');

    // Get the mission to check if it exists and if it's protected
    const mission = await repos.plans.get(missionId);
    if (!mission) {
      return res.status(404).json({ ok: false, error: 'Mission not found' });
    }

    // Check if mission is protected (shouldn't happen for unarchive, but checking for consistency)
    if (mission.is_protected) {
      return res.status(403).json({
        ok: false,
        error: 'Protected mission cannot be archived or deleted'
      });
    }

    // Check if mission is not archived
    if (mission.archived_at === null) {
      return res.status(400).json({ ok: false, error: 'Mission is not archived' });
    }

    // Unarchive the mission (set archived_at to null)
    const unarchivedMission = await repos.plans.update(mission.workspace_id, missionId, {
      archived_at: null
    });

    // Audit the action
    await audit.log({
      adapter,
      action_type: 'MISSION_UNARCHIVED',
      details: {
        missionId: missionId,
        missionTitle: mission.title,
        workspaceId: mission.workspace_id
      }
    });

    // Get updated workspace and owner info for response
    const workspace = await repos.workspaces.get(unarchivedMission.workspace_id);
    const owner = await repos.users.getById(workspace.owner_user_id);

    res.json({
      ok: true,
      mission: {
        id: unarchivedMission.id,
        title: unarchivedMission.title,
        goal: unarchivedMission.goal,
        status: unarchivedMission.status,
        priority: unarchivedMission.priority,
        archivedAt: unarchivedMission.archived_at,
        isProtected: unarchivedMission.is_protected,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug
        },
        owner: {
          id: owner.id,
          displayName: owner.display_name
        }
      }
    });
  } catch (err) {
    console.error('[Command Center] unarchive mission error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Revenue endpoint (simplified - could be expanded)
app.get('/api/admin/command-center/revenue', checkFounderSession, async (req, res) => {
  try {
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }

    const repos = require('../db/repos').createRepos(adapter);

    // Count active subscriptions by plan
    const subscriptions = await repos.subscriptions.list();
    const revenueByPlan = {
      founder: 0,
      trial: 0,
      solo: 0,
      growth: 0,
      corporate: 0
    };

    for (const sub of subscriptions) {
      if (sub.status === 'active') {
        const workspace = await repos.workspaces.get(sub.workspace_id);
        const plan = workspace ? workspace.plan : 'solo';
        if (revenueByPlan[plan] !== undefined) {
          revenueByPlan[plan]++;
        }
      }
    }

    // Calculate estimated MRR (simplified - would need actual pricing data)
    const PRICING = {
      founder: 0, // Founder is typically free/internal
      trial: 0,   // Trial is free
      solo: 99,   // $99/month
      growth: 299, // $299/month
      corporate: 999 // $999/month
    };

    let estimatedMrr = 0;
    for (const [plan, count] of Object.entries(revenueByPlan)) {
      estimatedMrr += (PRICING[plan] || 0) * count;
    }

    res.json({
      ok: true,
      estimatedMrr,
      revenueByPlan,
      activeSubscriptions: subscriptions.filter(s => s.status === 'active').length,
      totalSubscriptions: subscriptions.length
    });
  } catch (err) {
    console.error('[Command Center] revenue error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Dodo endpoint
app.get('/api/admin/command-center/dodo', checkFounderSession, async (req, res) => {
  try {
    const hasDodoApiKey = process.env.DODO_API_KEY !== undefined && process.env.DODO_API_KEY !== '';
    const hasDodoWebhookSecret = process.env.DODO_WEBHOOK_SECRET !== undefined && process.env.DODO_WEBHOOK_SECRET !== '';

    const starterMonthly = process.env.DODO_STARTER_MONTHLY_PID || null;
    const starterAnnual = process.env.DODO_STARTER_ANNUAL_PID || null;
    const growthMonthly = process.env.DODO_GROWTH_MONTHLY_PID || null;
    const growthAnnual = process.env.DODO_GROWTH_ANNUAL_PID || null;
    const businessMonthly = process.env.DODO_BUSINESS_MONTHLY_PID || null;
    const businessAnnual = process.env.DODO_BUSINESS_ANNUAL_PID || null;

    const teosMode = process.env.TEOS_MODE || 'not_set';
    const mode = require('../config/mode').getMode();

    // Check product mapping completeness
    const productMappingComplete = !!(
      starterMonthly && starterAnnual &&
      growthMonthly && growthAnnual &&
      businessMonthly && businessAnnual
    );

    res.json({
      ok: true,
      dodoApiKey: hasDodoApiKey ? 'CONFIGURED' : 'MISSING',
      dodoWebhookSecret: hasDodoWebhookSecret ? 'CONFIGURED' : 'MISSING',
      starterMonthly: starterMonthly ? 'CONFIGURED' : 'MISSING',
      starterAnnual: starterAnnual ? 'CONFIGURED' : 'MISSING',
      growthMonthly: growthMonthly ? 'CONFIGURED' : 'MISSING',
      growthAnnual: growthAnnual ? 'CONFIGURED' : 'MISSING',
      businessMonthly: businessMonthly ? 'CONFIGURED' : 'MISSING',
      businessAnnual: businessAnnual ? 'CONFIGURED' : 'MISSING',
      teosMode: teosMode,
      currentMode: mode,
      productMappingComplete: productMappingComplete ? 'COMPLETE' : 'INCOMPLETE',
      webhook: hasDodoWebhookSecret ? 'CONFIGURED' : 'MISSING',
      revenuePath: (hasDodoApiKey && hasDodoWebhookSecret) ? 'READY' : 'BLOCKED'
    });
  } catch (err) {
    console.error('[Command Center] dodo error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Agents endpoint
app.get('/api/admin/command-center/agents', checkFounderSession, async (req, res) => {
  try {
    const { getAdapter, createMemoryAdapter } = require('../db');
    let adapter;
    try {
      adapter = getAdapter();
    } catch (_err) {
      adapter = createMemoryAdapter();
    }

    const repos = require('../db/repos').createRepos(adapter);

    const agents = await repos.agents.list();
    const agentList = [];

    for (const agent of agents) {
      try {
        const workspace = await repos.workspaces.get(agent.workspace_id);
        const owner = await repos.users.getById(workspace.owner_user_id);

        agentList.push({
          id: agent.id,
          agentType: agent.agent_type,
          status: agent.status,
          provider: agent.provider,
          model: agent.model,
          lastRunAt: agent.last_run_at,
          nextRunAt: agent.next_run_at,
          totalRuns: agent.total_runs || 0,
          totalCostCents: agent.total_cost_cents || 0,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug
          },
          owner: {
            id: owner.id,
            displayName: owner.display_name
          }
        });
      } catch (e) {
        console.warn('[Command Center] error processing agent:', e.message);
        continue;
      }
    }

    res.json({ ok: true, agents: agentList });
  } catch (err) {
    console.error('[Command Center] agents error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Audit endpoint (reuse existing /api/audit but under command center path)
app.get('/api/admin/command-center/audit', checkFounderSession, async (req, res) => {
  try {
    const requested = parseInt(req.query.limit, 10);
    const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 100, 500);
    const entries = require('../utils/auditLogger').readTail(limit);
    res.json(entries.reverse());
  } catch (err) {
    console.error('[Command Center] audit error:', err.message);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((req, res) => {
  res.status(404).type('text').send('Not Found');
});

app.use((err, req, res, _next) => {
  console.error('[Sentinel] unhandled error:', err.message);
  res.status(err.status || 500).json({ error: 'internal_error' });
});

const server = app.listen(PORT, () => {
  console.log(`[Sentinel] TEOS DealMaker server on http://localhost:${PORT} (landing) and http://localhost:${PORT}/dashboard`);
  const { bootstrapFounder } = require('../services/founderSeed');
  bootstrapFounder()
    .then(result => {
      if (result && result.seeded && result.workspace) {
        console.log(`[Sentinel] founder workspace seeded (workspace #${result.workspace.id})`);
      }
    })
    .catch(err => console.error('[Sentinel] founder seed failed:', err && err.stack ? err.stack : err));
  const notify = require('../services/notify');
  notify.install();
  const learningHook = require('../services/learningHook');
  learningHook.install(() => require('../bot/store').getStoreAdapter());
  try {
    const { createWorker } = require('../services/outboundWorker');
    createWorker().start();
    console.log('[Sentinel] governed outbound worker started (24/7, defaults to PAUSED; resume requires founder action)');
  } catch (err) {
    console.error('[Sentinel] outbound worker failed to start:', err.message);
  }
  try {
    const { isSorEnabled } = require('../db');
    if (isSorEnabled()) {
      const revenueOps = require('../services/revenueOps');
      revenueOps.start().then(result => {
        if (result.ok) console.log(`[Sentinel] revenue ops clock started (interval ${result.intervalMs / 3600000}h; live guard gated — founder must resume before anything runs)`);
        else console.error('[Sentinel] revenue ops scheduler not started:', result.reason || 'unknown');
      }).catch(err => console.error('[Sentinel] revenue ops scheduler start failed:', err.message));
    } else {
      console.log('[Sentinel] revenue ops scheduler disabled (set SOR_ENABLED=true to enable 24/7 founder reports)');
    }
  } catch (err) {
    console.error('[Sentinel] revenue ops scheduler setup error:', err.message);
  }
  try {
    const missionScheduler = require('../services/missionScheduler');
    const { getAdapter: _getAdapter, createMemoryAdapter: _createMemoryAdapter } = require('../db');
    let msAdapter;
    try { msAdapter = _getAdapter(); } catch (_e) { msAdapter = _createMemoryAdapter(); }
    const msResult = missionScheduler.start(msAdapter);
    if (msResult.ok) console.log(`[Sentinel] mission scheduler started (interval ${msResult.intervalMs / 3600000}h)`);
    else console.log('[Sentinel] mission scheduler not started:', msResult.reason || 'unknown');
  } catch (err) {
    console.error('[Sentinel] mission scheduler setup error:', err.message);
  }
});

function shutdown(signal) {
  console.log(`[Sentinel] ${signal} received — closing HTTP server`);
  server.close(() => {
    process.exitCode = 0;
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
