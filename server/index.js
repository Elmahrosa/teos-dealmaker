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
      RESEND_TIMEOUT_MS: has('RESEND_TIMEOUT_MS')
    },
    revenue_path: has('DODO_API_KEY') && has('DODO_WEBHOOK_SECRET') ? 'CONFIRMED' : 'NOT_CONFIRMED',
    outbound: has('RESEND_API_KEY') ? 'CONFIGURED' : 'BLOCKED',
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
  const entries = audit.readVault();
  res.json(entries.slice(-limit).reverse());
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
