'use strict';

// Shared render helpers used by both the Express server (server/index.js) and
// the static production build (scripts/build-static.js). Keeping the render
// logic here guarantees the deployed bundle always matches the server output.

const fs = require('fs');
const path = require('path');
const PRICING = require('../config/pricing.config');
const { PRODUCT } = require('../config/product.config');

const SITE_URL = process.env.SITE_URL || 'https://dealmaker.elmahrosa.org';

// Per-cycle checkout pricing for a tier. The annual row always carries its
// real Dodo checkout CTA plus the founder-verified savings vs. monthly. Both
// rows stay in the DOM so the Monthly|Annual toggle only changes emphasis.
function renderPlanRows(t) {
  if (t.custom) {
    return `
    <div class="price-row" data-period="monthly">
      <span class="cycle">Monthly</span>
      <span class="amount">${t.monthly.price}</span>
    </div>
    <div class="price-row" data-period="annual">
      <span class="cycle">Annual</span>
      <span class="amount">${t.annual.price}</span>
    </div>
    <a class="buy" href="mailto:info@elmahrosa.org" data-period="custom">Contact Sales</a>`;
  }
  const m = t.monthly;
  const a = t.annual;
  const equiv = a.priceCents ? fmtMoney(Math.round(a.priceCents / 12)) + '/mo' : '';
  let save = '';
  if (m.priceCents && a.priceCents && a.priceCents < m.priceCents * 12) {
    const saveAmount = m.priceCents * 12 - a.priceCents;
    const savePct = Math.round((1 - a.priceCents / (m.priceCents * 12)) * 100);
    save = `<span class="save">SAVE ${fmtMoney(saveAmount)} (${savePct}%)</span>`;
  }
  return `
    <div class="price-row" data-period="monthly">
      <span class="cycle">Monthly</span>
      <span class="amount">${m.price}</span>
      <a class="buy" href="${m.url}" data-period="monthly">Start ${t.tier} Monthly</a>
    </div>
    <div class="price-row annual-row" data-period="annual">
      <span class="cycle">Annual</span>
      <span class="amount">${a.price}</span>
      ${equiv ? `<span class="equiv">${equiv}</span>` : ''}
      ${save}
      <a class="buy annual" href="${a.url}" data-period="annual">Choose ${t.tier} Annual</a>
    </div>`;
}

function renderPricingCards() {
  return PRICING.map(t => {
    const features = (t.features || []).map(f => `<li>${f}</li>`).join('');
    return `
    <div class="price-card">
      <h3>${t.tier}</h3>
      ${t.tagline ? `<p class="tagline">${t.tagline}</p>` : ''}
      ${renderPlanRows(t)}
      <ul>${features}</ul>
    </div>
  `;
  }).join('\n');
}

// Free Plugins — rendered only from the verified available-plugin registry
// (config/product.config.js). Nothing is hard-coded here; an entry appears
// only if it is implemented, usable, and enabled.
function renderFreePlugins() {
  const plugins = (PRODUCT.plugins || []);
  if (!plugins.length) return '';
  const cards = plugins.map(p => `
    <div class="card plugin-card">
      <h3>${p.name}${p.free && p.installed ? '<span class="badge" data-i18n="badge_free_installed">FREE · INSTALLED</span>' : ''}</h3>
      <p ${p.i18nKey ? `data-i18n="${p.i18nKey}"` : ''}>${p.description}</p>
      ${p.url ? `<a class="open-btn" href="${p.url}" data-i18n="plugin_open">Open →</a>` : ''}
    </div>`).join('');
  return `<div class="grid">${cards}</div>`;
}

// Elmahrosa commercial products — independent products, cross-linked only.
// No price, no checkout, no "included" claim: they are OPTIONAL add-ons, never
// part of any DealMaker plan or subscription.
function renderElmahrosaProducts() {
  const products = (PRODUCT.elmahrosaProducts || []);
  if (!products.length) return '';
  const cards = products.map(p => `
    <div class="card elmahrosa-product">
      <span class="independent-tag" data-i18n="elmahrosa_independent">OPTIONAL ADD-ON · INDEPENDENT PRODUCT</span>
      <h3>${p.name}</h3>
      <p class="tagline">${p.tagline}</p>
      <p>${p.description}</p>
      <p class="product-note" data-i18n="elmahrosa_note">Optional add-on — a separate product sold on its own pricing page. Not included with any DealMaker plan.</p>
      <div class="product-actions">
        <a class="cta" href="${p.url}" target="_blank" rel="noopener" data-i18n="elmahrosa_view">View product →</a>
        <a class="cta ghost" href="${p.url}" target="_blank" rel="noopener" data-i18n="elmahrosa_pricing">Pricing →</a>
      </div>
    </div>`).join('');
  const first = products[0];
  const cross = first ? `
    <p class="sect-sub elmahrosa-cross"><span data-i18n="elmahrosa_cross_q">Need enterprise AI execution governance?</span>
      <a href="${first.url}" target="_blank" rel="noopener" data-i18n="elmahrosa_cross_l">Explore TEOS Sentinel Shield →</a></p>` : '';
  return `
  <section id="elmahrosa-products" class="elmahrosa-products">
    <h2 class="sect" data-i18n="elmahrosa_products_t">ELMAHROSA PRODUCTS</h2>
    <p class="sect-sub" data-i18n="elmahrosa_products_sub">Optional add-ons — independent Elmahrosa products sold separately. Not included with the DealMaker base product.</p>
    <div class="grid">${cards}</div>${cross}
  </section>`;
}

function renderIntegrations() {
  const list = (PRODUCT.integrations || []);
  if (!list.length) return '';
  const cards = list.map(c => `
    <div class="card integration-card">
      <h3>${c.label}${c.free ? '<span class="badge" data-i18n="badge_free_installed">FREE · AVAILABLE</span>' : ''}</h3>
      <p>${c.description}</p>
      <span class="connector-note">${c.category} · ${c.auth === 'none' ? 'no key required' : 'key required'}</span>
    </div>`).join('');
  return `
  <section id="integrations" class="integrations">
    <h2 class="sect" data-i18n="sect_integrations">Integration Hub</h2>
    <p class="sect-sub" data-i18n="sub_integrations">Every connector runs through the governed integration hub. Free connectors need no key.</p>
    <div class="grid">${cards}</div>
  </section>`;
}

function renderAddons() {
  return (PRICING.ADDONS || []).map(a => `
    <div class="card">
      <h3>${a.name}</h3>
      <p>${a.description}</p>
    </div>
  `).join('\n');
}

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

function renderLanding(template) {
  return template
    .replace('{{PRICING_CARDS}}', renderPricingCards())
    .replace('{{PLUGIN_CARDS}}', renderFreePlugins())
    .replace('{{ELMAHROSA_PRODUCTS}}', renderElmahrosaProducts())
    .replace('{{INTEGRATIONS}}', renderIntegrations())
    .replace('{{ADDONS}}', renderAddons())
    .replace('{{ANALYTICS}}', analyticsSnippet())
    .replace(/\{\{SITE_URL\}\}/g, SITE_URL);
}

// The dashboard console only needs display fields; product IDs and checkout
// URLs are trimmed to the public short links so the shipped dashboard never
// leaks `pdt_` product ids into a public static artifact.
function renderDashboard(template) {
  const sanitized = PRICING.map(t => ({
    tier: t.tier,
    tagline: t.tagline || '',
    custom: !!t.custom,
    features: t.features || [],
    monthly: { price: t.monthly.price, url: t.monthly.shortUrl || t.monthly.url || '' },
    annual: { price: t.annual.price, url: t.annual.shortUrl || t.annual.url || '' }
  }));
  return template.replace('{{PRICING_JSON}}', JSON.stringify(sanitized));
}
function renderStart() {
  const startPath = path.join(__dirname, '..', 'public', 'start.html');
  return fs.readFileSync(startPath, 'utf8');
}

function renderStartThanks(intake) {
  const i = intake || {};
  const { CONTACT_FALLBACK } = require('../services/missionIntake');
  const hasContact = Boolean(i.contact) && i.contact !== CONTACT_FALLBACK;
  return pageHead('Mission received · TEOS DealMaker') + `\n  <header>\n    <span class="brand">TEOS DEALMAKER</span>\n    <a class="back" href="/">← Back to the landing page</a>\n  </header>\n  <h1>Mission brief received</h1>\n  <div class="okbox"><b>✓ Received</b> — your brief is recorded as intake #${esc(i.id)} with status <span class="status">${esc(i.status)}</span>.</div>\n  <h2>Mission brief</h2>\n  <table>\n    <tbody>\n      <tr><th>Mission</th><td>${esc(i.title)}</td></tr>\n      <tr><th>Business</th><td>${esc(i.objective)}</td></tr>\n      ${i.outcome ? `<tr><th>Success</th><td>${esc(i.outcome)}</td></tr>` : ''}\n      ${hasContact ? '<tr><th>Contact</th><td>Provided — we can reply</td></tr>' : '<tr><th>Contact</th><td>None provided</td></tr>'}\n      <tr><th>Recorded</th><td>${esc(i.created_at)}</td></tr>\n    </tbody>\n  </table>\n  <h2>What happens next</h2>\n  <p class="muted">The founder reviews your brief and assigns your dedicated AI Revenue Team. You will receive the mission plan for approval — the mission only executes under policy governance, and you decide whether to continue after the first mission. While you wait, <a href="https://t.me/TeosEgypt_bot">open the Telegram app</a> or <a href="/#playground">run the demo</a>.</p>\n  <footer><span>TEOS DealMaker · Elmahrosa International · <a href="mailto:info@elmahrosa.org">info@elmahrosa.org</a></span></footer>\n` + pageFoot;
}

function renderIntakesAdmin(rows) {
  const body = (rows || []).slice().reverse().map(i => `\n    <tr>\n      <td class="mono">#${esc(i.id)}</td>\n      <td>${esc(i.created_at)}</td>\n      <td>${esc(i.title)}</td>\n      <td>${esc((i.objective || '').slice(0, 90))}${(i.objective || '').length > 90 ? '…' : ''}</td>\n      <td>${esc(i.contact) || '—'}</td>\n      <td><span class="status">${esc(i.status)}</span></td>\n    </tr>`).join('');
  return pageHead('Mission Intakes · TEOS DealMaker') + `\n  <header>\n    <span class="brand">TEOS DEALMAKER · INTAKES</span>\n    <a class="back" href="/">← Landing page</a>\n  </header>\n  <h1>Mission Intakes</h1>\n  <p class="sub">${rows.length} received. Contact is shown only here — this console is audit-gated.</p>\n  <table>\n    <thead><tr><th>ID</th><th>Received</th><th>Mission</th><th>Business</th><th>Contact</th><th>Status</th></tr></thead>\n    <tbody>${body || '<tr><td colspan="6" class="muted">No intakes yet.</td></tr>'}</tbody>\n  </table>\n  <footer><span>TEOS DealMaker · Elmahrosa International</span></footer>\n` + pageFoot;
}

const START_CSS = `:root{--bg:#0b0f14;--panel:#131a23;--border:#1f2a37;--text:#d7e1ea;--muted:#7c8a99;--gold:#d4af37;--green:#3fbf6f;--red:#e05656;--blue:#4aa3df;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;padding:28px 18px;line-height:1.5;}
.wrap{max-width:720px;margin:0 auto;}
a{color:var(--blue);text-decoration:none;}
header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:26px;}
.brand{font-size:15px;letter-spacing:2px;color:var(--gold);font-weight:700;}
.back{margin-inline-start:auto;font-size:12px;}
h1{font-size:22px;letter-spacing:1px;color:var(--gold);}
h2{font-size:14px;letter-spacing:1px;color:var(--gold);margin:22px 0 10px;}
.sub{color:var(--muted);font-size:13px;margin-top:6px;}
ol.steps{display:flex;flex-wrap:wrap;gap:6px;margin:18px 0;list-style:none;padding:0;}
ol.steps li{font-size:11px;color:var(--muted);border:1px solid var(--border);border-radius:14px;padding:4px 10px;}
ol.steps li b{color:var(--gold);}
label{display:block;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin:14px 0 6px;}
input,select,textarea{width:100%;background:var(--panel);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:10px 12px;font-size:14px;font-family:inherit;}
textarea{min-height:90px;}
input:focus,textarea:focus{outline:none;border-color:var(--gold);}
button{background:var(--gold);color:#0b0f14;border:0;border-radius:6px;font-weight:700;letter-spacing:1px;font-size:14px;padding:12px 22px;cursor:pointer;margin-top:20px;}
button:hover{filter:brightness(1.1);}
.hint{font-size:11px;color:var(--muted);margin-top:4px;}
.check{display:flex;gap:8px;align-items:flex-start;margin-top:18px;font-size:12px;color:var(--muted);}
.check input{width:auto;margin-top:2px;}
.err{background:#2a1212;border:1px solid var(--red);color:#ffb0b0;border-radius:6px;padding:10px 12px;font-size:12px;margin-top:14px;display:none;}
.okbox{background:var(--panel);border:1px solid var(--border);border-left:3px solid var(--green);border-radius:6px;padding:14px 16px;margin:16px 0;}
.okbox b{color:var(--green);}
.muted{color:var(--muted);font-size:12px;}
footer{margin-top:34px;color:var(--muted);font-size:11px;border-top:1px solid var(--border);padding-top:14px;}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--border);border-radius:8px;overflow:hidden;}
th,td{text-align:left;padding:8px 12px;font-size:12px;border-bottom:1px solid var(--border);vertical-align:top;}
th{color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-size:11px;}
td.mono{font-family:Consolas,monospace;color:var(--blue);}
.status{display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;background:#241f10;color:var(--gold);}`;

const pageHead = (title) => `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex, nofollow">\n<title>${title}</title>\n<style>${START_CSS}</style>\n</head>\n<body>\n<div class="wrap">`;

const pageFoot = '</div>\n</body>\n</html>';

const REPORT_CSS = `
:root{--bg:#0b0f14;--panel:#131a23;--border:#1f2a37;--text:#d7e1ea;--muted:#7c8a99;--gold:#d4af37;--green:#3fbf6f;--red:#e05656;--blue:#4aa3df;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:"Segoe UI",system-ui,sans-serif;padding:32px;}
.wrap{max-width:960px;margin:0 auto;}
header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:24px;}
h1{font-size:20px;letter-spacing:2px;color:var(--gold);}
h2{font-size:15px;letter-spacing:1px;color:var(--gold);margin:26px 0 12px;}
h3{font-size:13px;letter-spacing:1px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;}
.sub{color:var(--muted);font-size:13px;}
.badge{display:inline-block;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:700;letter-spacing:1px;}
.badge.ok{background:#13241a;color:var(--green);}
.badge.warn{background:#241f10;color:var(--gold);}
.badge.err{background:#2a1212;color:var(--red);}
.stats{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0;}
.stat{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px 18px;min-width:150px;}
.stat .label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:1px;}
.stat .value{font-size:20px;margin-top:4px;}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--border);border-radius:8px;overflow:hidden;}
th,td{text-align:left;padding:8px 12px;font-size:12px;border-bottom:1px solid var(--border);vertical-align:top;}
th{color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-size:11px;}
td.mono{font-family:Consolas,monospace;font-size:11px;color:var(--blue);}
.done{color:var(--green);}
.fail{color:var(--red);}
.wait{color:var(--gold);}
.goal{background:var(--panel);border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:6px;padding:12px 16px;color:var(--text);}
.out{color:var(--muted);font-size:12px;line-height:1.5;}
.muted{color:var(--muted);}
footer{margin-top:28px;color:var(--muted);font-size:11px;border-top:1px solid var(--border);padding-top:14px;}
a{color:var(--blue);text-decoration:none;}
`;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtMoney(cents) {
  if (cents === null || cents === undefined) return '—';
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'min';
}

function statusBadge(status) {
  if (status === 'completed') return '<span class="badge ok">COMPLETED</span>';
  if (status === 'failed' || status === 'budget_exceeded') return '<span class="badge err">FAILED</span>';
  if (status === 'waiting_approval') return '<span class="badge warn">AWAITING APPROVAL</span>';
  if (status === 'running' || status === 'planned') return '<span class="badge warn">IN FLIGHT</span>';
  return '<span class="badge">' + esc(status) + '</span>';
}

function stepTone(s) {
  if (s.status === 'completed') return 'done';
  if (s.status === 'failed') return 'fail';
  if (s.status === 'awaiting_approval') return 'wait';
  return '';
}

function renderReportPage(header, body) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${header}</title>
<style>${REPORT_CSS}</style></head>
<body><div class="wrap">
${body}
<footer>TEOS DealMaker · Executive Governance Console · data is read-only from the audit vault · <a href="https://elmahrosa.org/trust" target="_blank" rel="noopener">Security &amp; Trust →</a></footer>
</div></body></html>`;
}

function renderMissionReport(report) {
  if (!report) return null;
  const { plan, timeline, kpis, agents, providers } = report;
  const mission = plan.mission || {};
  const goal = plan.goal || mission.goal || '';
  const timelineRows = timeline.length
    ? timeline.map(s => {
      const t = (s.completed_at || s.started_at || '').replace('T', ' ').slice(0, 16) + ' UTC';
      const conf = s.confidence === null ? '—' : s.confidence.toFixed(2);
      return `<tr class="${stepTone(s)}">
        <td class="mono">${esc(t)}</td>
        <td>${esc(s.agent_type)}<br><span class="muted">${esc(s.step_key)}</span></td>
        <td>${statusBadge(s.status)}</td>
        <td class="out">${esc(s.output || (s.error || ''))}</td>
        <td>${s.duration_ms === null ? '—' : fmtMs(s.duration_ms)}</td>
        <td>${conf}</td>
      </tr>`;
    }).join('')
    : '<tr><td colspan="6" class="muted">No steps executed yet.</td></tr>';

  const agentRows = agents.length
    ? agents.map(a => `<tr><td>${esc(a.agent_type)}</td><td>${a.completed}/${a.total}</td><td>${a.failed}</td><td>${a.utilization}%</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">No agent activity yet.</td></tr>';

  const providerLines = providers.length
    ? providers.map(p => `• ${esc(p.provider)} (${p.count})`).join('<br>')
    : '<span class="muted">No provider calls recorded.</span>';

  return renderReportPage(`Mission #${plan.id} · ${esc(plan.title)}`, `
  <header>
    <h1>EXECUTIVE MISSION REPORT</h1>
    <span class="sub">${esc(plan.title)} · Mission #${plan.id} · ${esc(plan.created_at ? plan.created_at.slice(0, 10) : '')}</span>
    <span style="margin-inline-start:auto;">${statusBadge(plan.status)}</span>
  </header>

  <h2>OBJECTIVE</h2>
  <p class="goal">${esc(goal)}</p>
  ${mission.target_customer ? `<p class="muted" style="margin-top:8px;">Target customer: ${esc(mission.target_customer)} · Market: ${esc(mission.target_market || '—')} · Priority: ${esc(plan.priority || '—')}</p>` : ''}

  <div class="stats">
    <div class="stat"><div class="label">Completion</div><div class="value">${kpis.completed_steps}/${kpis.total_steps}</div></div>
    <div class="stat"><div class="label">Success rate</div><div class="value">${kpis.success_rate}%</div></div>
    <div class="stat"><div class="label">Cost</div><div class="value">${fmtMoney(kpis.total_cost_cents)}</div></div>
    <div class="stat"><div class="label">Budget</div><div class="value">${kpis.budget_cents === null ? '—' : fmtMoney(kpis.budget_cents)}</div></div>
    <div class="stat"><div class="label">Duration</div><div class="value">${fmtMs(kpis.duration_ms)}</div></div>
    ${kpis.revenue_cents === null ? '' : `<div class="stat"><div class="label">Revenue identified</div><div class="value">${fmtMoney(kpis.revenue_cents)}</div></div>`}
  </div>

  <h2>EXECUTIVE MISSION TIMELINE</h2>
  <table>
    <thead><tr><th>Time</th><th>Agent</th><th>Status</th><th>Output</th><th>Duration</th><th>Confidence</th></tr></thead>
    <tbody>${timelineRows}</tbody>
  </table>

  <h2>MISSION KPIs</h2>
  <div class="stats">
    <div class="stat"><div class="label">Completed</div><div class="value">${kpis.completed_steps}</div></div>
    <div class="stat"><div class="label">Failed</div><div class="value">${kpis.failed_steps}</div></div>
    <div class="stat"><div class="label">Skipped</div><div class="value">${kpis.skipped_steps}</div></div>
    <div class="stat"><div class="label">Awaiting approval</div><div class="value">${kpis.awaiting_approval}</div></div>
    <div class="stat"><div class="label">Avg confidence</div><div class="value">${kpis.avg_confidence === null ? '—' : kpis.avg_confidence.toFixed(2)}</div></div>
    <div class="stat"><div class="label">Approvals requested</div><div class="value">${kpis.approvals_requested}</div></div>
  </div>

  <h2>WORKFORCE UTILIZATION</h2>
  <table>
    <thead><tr><th>Agent</th><th>Completed/Total</th><th>Failed</th><th>Utilization</th></tr></thead>
    <tbody>${agentRows}</tbody>
  </table>

  <h2>PROVIDER USAGE</h2>
  <p class="out">${providerLines}</p>
`);
}

function renderCustomerZero(report) {
  if (!report) return null;
  const { plan, kpis } = report;
  const milestone = kpis.completed_steps === kpis.total_steps;
  return renderReportPage('Customer #0 · TEOS DealMaker', `
  <header>
    <h1>CUSTOMER #0 · ELMAHROSA INTERNATIONAL</h1>
    <span class="sub">First reference deployment · ${esc(plan.title)}</span>
    <span style="margin-inline-start:auto;">${statusBadge(plan.status)}</span>
  </header>
  <div class="stats">
    <div class="stat"><div class="label">Mission progress</div><div class="value">${kpis.completed_steps}/${kpis.total_steps}</div></div>
    <div class="stat"><div class="label">Completion</div><div class="value">${kpis.completion_rate}%</div></div>
    <div class="stat"><div class="label">Total cost</div><div class="value">${fmtMoney(kpis.total_cost_cents)}</div></div>
  </div>
  <h2>PROOF POINT</h2>
  <p class="goal">${milestone
    ? 'TEOS DealMaker executed its full AI revenue workflow against itself — every step of the 13-agent mission completed and recorded in the audit vault.'
    : 'Customer #0 reference mission is in flight — TEOS DealMaker is running its own AI revenue workflow end to end.'}</p>
  <p class="muted" style="margin-top:12px;">View the full <a href="/report/${plan.id}">Executive Mission Report #${plan.id}</a> for the timeline, KPIs and workforce utilization.</p>
`);
}

function renderCustomer0ReviewPage(queue, opts) {
  const o = opts || {};
  const rows = (queue || []).map(q => `
  <div class="review-item">
    <h2>#${q.id} · ${esc(q.company || q.to)} <span class="badge ${q.expired ? 'err' : 'warn'}">${q.expired ? 'EXPIRED' : esc(q.status)}</span></h2>
    <table>
      <tr><td>WHO</td><td>${esc(q.buyer || 'not identified')}${q.buyer_role ? ' — ' + esc(q.buyer_role) : ''} @ ${esc(q.company)} (${esc(q.country || '—')})</td></tr>
      <tr><td>WHY</td><td>${esc(q.pain_hypothesis || '—')} ${q.evidence && q.evidence.length ? '<br><span class="muted">' + esc(q.evidence.map(e => e.source + ': ' + e.summary).join(' · ')) + '</span>' : ''}</td></tr>
      <tr><td>WHAT</td><td class="mono">${esc(q.subject)}</td></tr>
      <tr><td>MESSAGE</td><td class="out"><pre>${esc(q.body)}</pre></td></tr>
      <tr><td>CHANNEL</td><td>${esc(q.channel)} → ${esc(q.to)} · version ${esc(q.draft_version)} · hash ${esc(q.draft_hash)}</td></tr>
      <tr><td>OUTCOME</td><td>${esc(q.expected_outcome)}</td></tr>
      <tr><td>DECISION</td><td><span class="muted">POST ${esc(o.approveBase || '/api/customer-0/approvals')}/${q.id}/approve (or /reject with {"reason":"..."}) with <code>Authorization: Bearer &lt;founder session token&gt;</code>. Decisions are recorded in the audit vault. Nothing sends until the outbound worker is RUNNING.</span></td></tr>
    </table>
  </div>`).join('');

  return renderReportPage('Customer #0 · Governed Outreach Review', `
  <header>
    <h1>CUSTOMER #0 · GOVERNED OUTREACH REVIEW</h1>
    <span class="sub">TEOS DealMaker sells to DealMaker · decisions require the authenticated founder session</span>
    <span style="margin-inline-start:auto;">${rows.length ? '<span class="badge warn">' + rows.length + ' PENDING</span>' : '<span class="badge ok">QUEUE CLEAR</span>'}</span>
  </header>
  <p class="goal">Every row is a governed outbound draft. Approving stamps approved_by/approved_at on the draft and records the decision in the audit vault; it does not send anything. Sending only happens when the outbound worker is RUNNING with the Resend key configured.</p>
  ${rows || '<p class="muted">No pending Customer #0 outreach drafts.</p>'}
`);
}

function robotsTxt() {
  return `User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /report\nDisallow: /reports\nDisallow: /customer-0\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

function sitemapXml() {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${SITE_URL}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n  <url>\n    <loc>${SITE_URL}/start</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>\n</urlset>\n`;
}

module.exports = {
  SITE_URL,
  PRICING,
  renderPricingCards,
  renderFreePlugins,
  renderElmahrosaProducts,
  renderAddons,
  analyticsSnippet,
  renderLanding,
  renderDashboard,
  renderIntegrations,
  renderStart,
  renderStartThanks,
  renderIntakesAdmin,
  renderMissionReport,
  renderCustomerZero,
  renderCustomer0ReviewPage,
  robotsTxt,
  sitemapXml
};
