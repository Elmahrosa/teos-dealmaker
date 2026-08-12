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

  const productsBlock = html.match(/<section id="elmahrosa-products"[\s\S]*?<\/section>/);
  check(!!productsBlock, 'elmahrosa products section present');
  if (productsBlock) {
    check(!productsBlock[0].includes('checkout.dodopayments.com'), 'elmahrosa products section has no Dodo checkout link');
    check(productsBlock[0].includes('sentinel.teosegypt.com'), 'elmahrosa products section cross-links to sentinel.teosegypt.com');
    check(productsBlock[0].includes('INDEPENDENT PRODUCT'), 'elmahrosa products are labelled as independent');
  }
  // Sentinel must NOT appear as a DealMaker section, plugin, or installed item.
  check((html.match(/id="sentinel"/g) || []).length === 0, 'no #sentinel section remains inside DealMaker');
  check(!/[Cc]oming\s?soon/i.test(html), 'no coming-soon placeholders in the rendered landing page');

  const enBlock = html.slice(html.indexOf('en: {'), html.indexOf('ar: {'));
  const arBlock = html.slice(html.indexOf('ar: {'), html.indexOf('};'));
  for (const [name, block] of [['en', enBlock], ['ar', arBlock]]) {
    const seen = {};
    for (const m of block.matchAll(/\n\s*([a-z_0-9]+):/g)) seen[m[1]] = (seen[m[1]] || 0) + 1;
    const dups = Object.entries(seen).filter(([, c]) => c > 1).map(([k]) => k);
    check(dups.length === 0, name + ' dict has no duplicate i18n keys' + (dups.length ? ': ' + dups.join(', ') : ''));
  }

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

