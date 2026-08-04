const path = require('path');
const fs = require('fs');
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

app.get('/', (req, res) => {
  const template = fs.readFileSync(path.join(__dirname, 'landing.html'), 'utf8');
  res.type('html').send(
    template
      .replace('{{PRICING_CARDS}}', renderPricingCards())
      .replace('{{ADDONS}}', renderAddons())
  );
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'sentinel.html'));
});

app.listen(PORT, () => {
  console.log(`[Sentinel] TEOS DealMaker server on http://localhost:${PORT} (landing) and http://localhost:${PORT}/dashboard`);
});
