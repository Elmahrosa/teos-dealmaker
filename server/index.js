const path = require('path');
const fs = require('fs');
require('dotenv').config();
const express = require('express');
const audit = require('../utils/auditLogger');
const { getMode } = require('../config/mode');
const PRICING = require('../config/pricing.config');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/pricing', (req, res) => {
  res.json({ tiers: PRICING, addons: PRICING.ADDONS });
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

function renderPricingCards() {
  return PRICING.map(t => {
    const features = (t.features || []).map(f => `<li>${f}</li>`).join('');
    const monthly = t.monthly.url
      ? `<div class="price-row"><span class="cycle">Monthly</span><span class="amount">${t.monthly.price}</span></div>
      <a class="buy" href="${t.monthly.url}">Start ${t.tier} Monthly</a>`
      : `<div class="price-row"><span class="cycle">Monthly</span><span class="amount">${t.monthly.price}</span></div>`;
    const annual = t.annual.url
      ? `<div class="price-row"><span class="cycle">Annual</span><span class="amount">${t.annual.price}</span></div>
      <a class="buy annual" href="${t.annual.url}">Start ${t.tier} Annual</a>`
      : `<div class="price-row"><span class="cycle">Annual</span><span class="amount">${t.annual.price}</span></div>`;
    const cta = t.custom
      ? '<a class="buy" href="mailto:info@elmahrosa.com">Contact Sales</a>'
      : '';
    const pids = (t.productIds.monthly || t.productIds.annual)
      ? `<div class="pid">${t.productIds.monthly} / ${t.productIds.annual}</div>`
      : '';
    return `
    <div class="price-card">
      <h3>${t.tier}</h3>
      ${t.tagline ? `<p class="tagline">${t.tagline}</p>` : ''}
      ${monthly}
      ${annual}
      ${cta}
      <ul>${features}</ul>
      ${pids}
    </div>
  `;
  }).join('\n');
}

function renderAddons() {
  return (PRICING.ADDONS || []).map(a => `
    <div class="card">
      <h3>${a.name}</h3>
      <p>${a.description}</p>
    </div>
  `).join('\n');
}

const SITE_URL = process.env.SITE_URL || 'https://dealmaker.elmahrosa.org';

function analyticsSnippet() {
  const parts = [];
  if (process.env.ANALYTICS_GA4) {
    parts.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${process.env.ANALYTICS_GA4}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${process.env.ANALYTICS_GA4}');</script>`);
  }
  if (process.env.ANALYTICS_CLARITY) {
    parts.push(`<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script","${process.env.ANALYTICS_CLARITY}");</script>`);
  }
  if (process.env.ANALYTICS_LINKEDIN) {
    parts.push(`<script type="text/javascript">_linkedin_partner_id="${process.env.ANALYTICS_LINKEDIN}";window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(_linkedin_partner_id);</script>
<script type="text/javascript">(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}var s=document.getElementsByTagName("script")[0];var b=document.createElement("script");b.type="text/javascript";b.async=true;b.src="https://snap.licdn.com/li.lms-analytics/insight.min.js";s.parentNode.insertBefore(b,s)})(window.lintrk);</script>`);
  }
  if (process.env.ANALYTICS_META_PIXEL) {
    parts.push(`<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${process.env.ANALYTICS_META_PIXEL}');fbq('track','PageView');</script>`);
  }
  return parts.join('\n');
}

app.get('/', (req, res) => {
  const template = fs.readFileSync(path.join(__dirname, 'landing.html'), 'utf8');
  res.type('html').send(
    template
      .replace('{{PRICING_CARDS}}', renderPricingCards())
      .replace('{{ADDONS}}', renderAddons())
      .replace('{{ANALYTICS}}', analyticsSnippet())
      .replace(/\{\{SITE_URL\}\}/g, SITE_URL)
  );
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /dashboard\nSitemap: ${SITE_URL}/sitemap.xml\n`
  );
});

app.get('/sitemap.xml', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${SITE_URL}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`
  );
});

app.get('/favicon.svg', (req, res) => {
  res.type('image/svg+xml').sendFile(path.join(__dirname, 'favicon.svg'));
});

app.get('/og-image.svg', (req, res) => {
  res.type('image/svg+xml').sendFile(path.join(__dirname, 'og-image.svg'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'sentinel.html'));
});

app.listen(PORT, () => {
  console.log(`[Sentinel] TEOS DealMaker server on http://localhost:${PORT} (landing) and http://localhost:${PORT}/dashboard`);
});
