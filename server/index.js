const path = require('path');
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'sentinel.html'));
});

app.listen(PORT, () => {
  console.log(`[Sentinel] TEOS DealMaker dashboard on http://localhost:${PORT}`);
});
