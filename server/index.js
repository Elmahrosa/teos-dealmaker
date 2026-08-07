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
