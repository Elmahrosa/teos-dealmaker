// scripts/audit-links.js
// Navigation / link audit for the shipped frontend (hostinger static bundle
// plus the server-rendered routes). Every link must resolve to a real route,
// a real anchor, an external destination, or a mailto: link.
//
// Usage: node scripts/audit-links.js
// Exit code 1 if any broken link or missing route is found.

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const OUT_DIR = path.join(root, 'hostinger');

const KNOWN_ROUTES = [
  '/', '/start', '/start/thanks', '/dashboard', '/dashboard/',
  '/reports', '/report/:planId', '/customer-0', '/intakes',
  '/api/health', '/api/pricing', '/api/outreach/status', '/api/reports/latest',
  '/api/outreach/queue', '/api/emails', '/api/audit', '/api/diagnostics',
  '/api/deploy-verify', '/api/intake', '/api/intakes',
  '/webhook/dodo', '/webhook/resend',
  '/robots.txt', '/sitemap.xml', '/favicon.svg', '/og-image.svg', '/og-image.png',
  '/health'
];

const EXTERNAL_OK = [
  'https://t.me/TeosEgypt_bot',
  'https://elmahrosa.org/trust',
  'https://www.credly.com/',
  'https://checkout.dodopayments.com/',
  'https://dodo.pe/',
  'https://sentinel.teosegypt.com',
  'https://dealmaker.elmahrosa.org/',
  'mailto:'
];

function isAnchor(target, html) {
  const id = target.replace(/^#/, '');
  return new RegExp(`id=["']${id}["']`).test(html);
}

function auditFile(filePath, label) {
  const html = fs.readFileSync(filePath, 'utf8');
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const breaks = [];
  const seen = new Set();
  for (const href of hrefs) {
    if (seen.has(href)) continue;
    seen.add(href);
    if (!href || href.startsWith('#')) {
      if (href && !isAnchor(href, html)) breaks.push(`anchor not found: ${href}`);
      continue;
    }
    if (/^https?:|^mailto:|^tel:/.test(href)) {
      if (!EXTERNAL_OK.some((ok) => href.startsWith(ok))) {
        breaks.push(`unverified external link: ${href}`);
      }
      continue;
    }
    const pathOnly = href.split('#')[0].split('?')[0];
    const route = pathOnly.replace(/\/+$/, '') || '/';
    const known = KNOWN_ROUTES.some((k) => {
      if (route === k) return true;
      if (k.includes(':planId')) return /^\/report\/\d+$/.test(route);
      return false;
    });
    if (!known && !href.startsWith('/api/')) breaks.push(`missing route: ${href}`);
  }
  if (breaks.length) {
    console.error(`✗ ${label}: ${breaks.length} issue(s)`);
    breaks.forEach((b) => console.error(`    - ${b}`));
    return breaks;
  }
  console.log(`✓ ${label}: ${hrefs.length} link(s) checked, 0 broken`);
  return [];
}

function auditForms(filePath, label) {
  const html = fs.readFileSync(filePath, 'utf8');
  const actions = [...html.matchAll(/<form[^>]*action\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const breaks = [];
  for (const a of actions) {
    const route = a.replace(/\/+$/, '') || '/';
    if (!KNOWN_ROUTES.some((k) => route === k)) breaks.push(`form action missing route: ${a}`);
  }
  if (breaks.length) {
    breaks.forEach((b) => console.error(`    - ${b}`));
    return breaks;
  }
  if (actions.length) console.log(`✓ ${label}: ${actions.length} form action(s) resolve`);
  return [];
}

const files = [
  ['index.html', 'landing'],
  ['start.html', 'start'],
  ['dashboard/index.html', 'dashboard']
];

let broken = 0;
for (const [file, label] of files) {
  const p = path.join(OUT_DIR, file);
  if (!fs.existsSync(p)) {
    console.error(`✗ ${label}: ${file} missing from static build`);
    broken += 1;
    continue;
  }
  broken += auditFile(p, label).length;
  broken += auditForms(p, label).length;
}

// Verify the /start form posts to the new intake API.
const startHtml = fs.readFileSync(path.join(OUT_DIR, 'start.html'), 'utf8');
if (!/\/api\/intake/.test(startHtml)) {
  console.error('✗ start.html does not post to /api/intake');
  broken += 1;
} else {
  console.log('✓ start.html posts to POST /api/intake');
}

// Verify no stale route references in the shipped frontend.
const stalePatterns = [/\/api\/missions\b/, /\/missions\b/];
for (const [file] of files) {
  const html = fs.readFileSync(path.join(OUT_DIR, file), 'utf8');
  for (const re of stalePatterns) {
    if (re.test(html)) {
      console.error(`✗ stale reference ${re} in ${file}`);
      broken += 1;
    }
  }
}

if (broken) {
  console.error(`\nBROKEN_LINKS = ${broken}`);
  process.exit(1);
}
console.log('\nBROKEN_LINKS = 0 · MISSING_ROUTES = 0');
