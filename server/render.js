'use strict';

// Shared render helpers used by both the Express server (server/index.js) and
// the static production build (scripts/build-static.js). Keeping the render
// logic here guarantees the deployed bundle always matches the server output.

const PRICING = require('../config/pricing.config');

const SITE_URL = process.env.SITE_URL || 'https://dealmaker.elmahrosa.org';

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
    .replace('{{ADDONS}}', renderAddons())
    .replace('{{ANALYTICS}}', analyticsSnippet())
    .replace(/\{\{SITE_URL\}\}/g, SITE_URL);
}

function renderDashboard(template) {
  return template.replace('{{PRICING_JSON}}', JSON.stringify(PRICING));
}

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
<footer>TEOS DealMaker · Executive Governance Console · data is read-only from the audit vault</footer>
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
    <div class="stat"><div class="label">Revenue identified</div><div class="value">${kpis.revenue_cents === null ? '—' : fmtMoney(kpis.revenue_cents)}</div></div>
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
    <div class="stat"><div class="label">Pipeline value</div><div class="value">${fmtMoney(kpis.revenue_cents)}</div></div>
    <div class="stat"><div class="label">Total cost</div><div class="value">${fmtMoney(kpis.total_cost_cents)}</div></div>
  </div>
  <h2>PROOF POINT</h2>
  <p class="goal">${milestone
    ? 'TEOS DealMaker executed its full AI revenue workflow against itself — every step of the 13-agent mission completed and recorded in the audit vault.'
    : 'Customer #0 reference mission is in flight — TEOS DealMaker is running its own AI revenue workflow end to end.'}</p>
  <p class="muted" style="margin-top:12px;">View the full <a href="/report/${plan.id}">Executive Mission Report #${plan.id}</a> for the timeline, KPIs and workforce utilization.</p>
`);
}

function robotsTxt() {
  return `User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /report\nDisallow: /customer-0\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

function sitemapXml() {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${SITE_URL}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`;
}

module.exports = {
  SITE_URL,
  PRICING,
  renderPricingCards,
  renderAddons,
  analyticsSnippet,
  renderLanding,
  renderDashboard,
  renderMissionReport,
  renderCustomerZero,
  robotsTxt,
  sitemapXml
};
