// tests/test-link-audit.js
// Audits every external link in the rendered landing page:
//   - no unreplaced {{PLACEHOLDER}} tokens
//   - the Sentinel cross-sell is a CROSS-LINK only (no Dodo checkout, no price)
//   - every rendered Dodo checkout href matches pricing.config (no drift)
//   - every http(s) href parses as a valid absolute URL
//   - every external link is reachable (status < 400) via HEAD with a GET retry
// Set LINK_AUDIT_OFFLINE=1 to skip the network pass (structural checks only).
'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || '';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const render = require('../server/render');

(async () => {
  let n = 0;
  const check = (cond, msg) => { assert.ok(cond, msg); n += 1; };

  const template = fs.readFileSync(path.join(__dirname, '..', 'server', 'landing.html'), 'utf8');
  const html = render.renderLanding(template);

  check(!/\{\{[A-Z_]+\}\}/.test(html), 'no unreplaced {{PLACEHOLDER}} tokens');

  const sentinelBlock = html.match(/<section id="sentinel-shield"[\s\S]*?<\/section>/);
  check(!!sentinelBlock, 'sentinel cross-sell section present');
  if (sentinelBlock) {
    check(!sentinelBlock[0].includes('checkout.dodopayments.com'), 'sentinel section has no Dodo checkout link');
    check(sentinelBlock[0].includes('sentinel.teosegypt.com'), 'sentinel section cross-links to sentinel.teosegypt.com');
  }
  check((html.match(/id="sentinel"/g) || []).length === 1, 'single element carries the #sentinel id');

  const expectedDodo = [];
  for (const t of render.PRICING) {
    if (t.monthly.url) expectedDodo.push(t.monthly.url);
    if (t.annual.url) expectedDodo.push(t.annual.url);
  }
  const dodoHrefs = [...html.matchAll(/href="(https:\/\/checkout\.dodopayments\.com[^"]+)"/g)].map(m => m[1]);
  check(dodoHrefs.length === expectedDodo.length, 'rendered Dodo checkout links match non-custom tiers');
  for (const u of expectedDodo) {
    check(dodoHrefs.includes(u), 'rendered Dodo link matches config: ' + u);
  }

  const hrefs = [...html.matchAll(/href="(https?:[^"]+)"/g)].map(m => m[1]);
  check(hrefs.length > 0, 'found external links to audit');
  const bad = hrefs.filter(h => {
    try { return !new URL(h).hostname; } catch (_e) { return true; }
  });
  check(bad.length === 0, 'all hrefs parse as valid absolute URLs');

  const unique = [...new Set(hrefs)];
  if (process.env.LINK_AUDIT_OFFLINE === '1') {
    console.log(`SKIP network pass (${unique.length} unique links) — LINK_AUDIT_OFFLINE=1`);
  } else {
    const results = await Promise.all(unique.map(u => probe(u)));
    const failures = results.filter(r => !r.ok);
    for (const f of failures) console.error(`  FAIL ${f.url} -> ${f.reason}`);
    check(failures.length === 0, `all ${unique.length} external links reachable (status < 400)`);
  }

  console.log(`\nPASS ${n} assertions (test-link-audit) · ${unique.length} unique external links`);
  process.exit(0);
})().catch(err => {
  console.error('test-link-audit FAILED:', err && err.stack || err);
  process.exit(1);
});

function probe(url) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const reasonOf = (err) => (err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || String(err));
    const tryGet = (err) => {
      fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal })
        .then(res => finish(res.status >= 400 ? { url, ok: false, reason: 'status ' + res.status } : { url, ok: true, status: res.status }))
        .catch(err2 => finish({ url, ok: false, reason: reasonOf(err || err2) }));
    };
    fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal })
      .then(res => finish(res.status >= 400 ? { url, ok: false, reason: 'status ' + res.status } : { url, ok: true, status: res.status }))
      .catch(err => tryGet(err));
  });
}
