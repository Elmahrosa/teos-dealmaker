const path = require('path');
const fs = require('fs');
require('dotenv').config();
const express = require('express');
const audit = require('../utils/auditLogger');
const { getMode } = require('../config/mode');
const billing = require('../services/billing');
const render = require('./render');

const app = express();
const PORT = process.env.PORT || 3000;

function contentSecurityPolicy() {
  const scriptSrc = ['\'self\'', '\'unsafe-inline\''];
  if (process.env.ANALYTICS_GA4) scriptSrc.push('https://www.googletagmanager.com');
  if (process.env.ANALYTICS_CLARITY) scriptSrc.push('https://www.clarity.ms');
  if (process.env.ANALYTICS_LINKEDIN) scriptSrc.push('https://snap.licdn.com');
  if (process.env.ANALYTICS_META_PIXEL) scriptSrc.push('https://connect.facebook.net');
  return [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(' ')}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' https:`,
    `frame-ancestors 'self'`,
    `base-uri 'self'`,
    `form-action 'self' https:`
  ].join('; ');
}

app.set('trust proxy', 1);

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

app.get('/api/pricing', (req, res) => {
  res.json({ tiers: render.PRICING, addons: render.PRICING.ADDONS });
});

app.get('/api/health', (req, res) => {
  const entries = audit.readVault();
  res.json({
    status: 'ok',
    mode: getMode(),
    totalEntries: entries.length,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/audit', (req, res) => {
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

app.get('/favicon.svg', (req, res) => {
  res.type('image/svg+xml').sendFile(path.join(__dirname, 'favicon.svg'));
});

app.get('/og-image.svg', (req, res) => {
  res.type('image/svg+xml').sendFile(path.join(__dirname, 'og-image.svg'));
});

app.get('/og-image.png', (req, res) => {
  res.type('image/png').sendFile(path.join(__dirname, 'og-image.png'));
});

app.get('/dashboard', (req, res) => {
  res.type('html').send(
    render.renderDashboard(
      fs.readFileSync(path.join(__dirname, 'sentinel.html'), 'utf8')
    )
  );
});

app.listen(PORT, () => {
  console.log(`[Sentinel] TEOS DealMaker server on http://localhost:${PORT} (landing) and http://localhost:${PORT}/dashboard`);
});
