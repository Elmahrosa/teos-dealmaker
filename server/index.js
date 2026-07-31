const path = require('path');
const fs = require('fs');
const express = require('express');
const audit = require('../utils/auditLogger');
const { getMode } = require('../config/mode');
const PRICING = require('../config/pricing.config');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/pricing', (req, res) => {
  res.json(PRICING);
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
  return PRICING.map(t => `
    <div class="price-card">
      <h3>${t.tier}</h3>
      <div class="price-row"><span class="cycle">Monthly</span><span class="amount">${t.monthly.price}</span></div>
      <a class="buy" href="${t.monthly.url}">Start ${t.tier} Monthly</a>
      <div class="price-row"><span class="cycle">Annual</span><span class="amount">${t.annual.price}</span></div>
      <a class="buy annual" href="${t.annual.url}">Start ${t.tier} Annual</a>
      <div class="pid">${t.productIds.monthly} / ${t.productIds.annual}</div>
    </div>
  `).join('\n');
}

app.get('/', (req, res) => {
  const template = fs.readFileSync(path.join(__dirname, 'landing.html'), 'utf8');
  res.type('html').send(template.replace('{{PRICING_CARDS}}', renderPricingCards()));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'sentinel.html'));
});

app.listen(PORT, () => {
  console.log(`[Sentinel] TEOS DealMaker server on http://localhost:${PORT} (landing) and http://localhost:${PORT}/dashboard`);
});
