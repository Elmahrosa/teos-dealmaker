// RC1 conversation validation — production-style scenarios against live DATABASE_URL.
// Run via: PG_REJECT_UNAUTHORIZED=false npx -y @railway/cli run -s web -- node scripts/rc1-convo-check.js
// Read-only by design: mission/customer creation writes are covered by the local suite
// and by the live Customer #0 mission (#26, completed 13/13).

'use strict';

const router = require('../services/router');
const memory = require('../services/router/memory');
const { getAdapter } = require('../db');

const FORBIDDEN = [/\/start/i, /unknown command/i, /coming soon/i, /badge_soon/i, /coming-soon/i];

const FOUNDER = Number(process.env.TEOS_FOUNDER_TELEGRAM_ID || 0);

const results = [];
const latencies = { fast: [], slow: [] };

function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
}

function scanForbidden(text, label) {
  const hits = FORBIDDEN.filter(re => re.test(text));
  return { hits, ok: hits.length === 0 };
}

async function main() {
  if (!FOUNDER) throw new Error('TEOS_FOUNDER_TELEGRAM_ID required');
  const adapter = getAdapter();
  memory.reset();

  const send = async (text, label) => {
    const r = await router.handleText(adapter, FOUNDER, text);
    const fb = scanForbidden(r.text, label);
    const path = (r.trace && r.trace.path) || (r.trace && r.trace.latencyMs != null ? '?' : 'n/a');
    const lat = r.trace && r.trace.latencyMs != null ? r.trace.latencyMs : null;
    if (path === 'fast') latencies.fast.push(lat);
    if (path === 'slow' && lat) latencies.slow.push(lat);
    return { r, fb, path, lat };
  };

  // 1. Greetings
  const g = await send('hello', 'greeting');
  record('greeting intent', g.r.trace.intent === 'greeting', `intent=${g.r.trace.intent}`);
  record('greeting no forbidden text', g.fb.ok, g.fb.ok ? 'clean' : g.fb.hits.join(','));

  // 2. Help
  const h = await send('help', 'help');
  record('help intent', h.r.trace.intent === 'help', `intent=${h.r.trace.intent}`);
  record('help no forbidden text', h.fb.ok, h.fb.ok ? 'clean' : h.fb.hits.join(','));

  // 3. Mixed Arabic / English
  const ar = await send('مرحبا', 'arabic greeting');
  record('arabic greeting native reply', /[\u0600-\u06FF]/.test(ar.r.text), ar.r.text.slice(0, 60));
  record('arabic greeting no forbidden text', ar.fb.ok, ar.fb.ok ? 'clean' : ar.fb.hits.join(','));
  const en = await send('status', 'status after arabic');
  record('en/ar language switching', en.r.trace.intent === 'status' && !/[\u0600-\u06FF]/.test(en.r.text), 'switched back to English');

  // 4. Status (live mission state — founder workspace #26 context)
  const st = await send('status', 'status');
  record('status action', st.r.trace.action === 'status', `action=${st.r.trace.action}`);
  record('status surfaces current mission', /Status:/i.test(st.r.text), st.r.text.slice(0, 90));

  // 5. Analytics
  const an = await send('show analytics', 'analytics');
  record('analytics action', an.r.trace.action === 'analytics', `action=${an.r.trace.action}`);
  record('analytics numeric', /\d+/.test(an.r.text), an.r.text.slice(0, 90));

  // 6. Revenue
  const rv = await send('revenue', 'revenue');
  record('revenue action', rv.r.trace.action === 'revenue', `action=${rv.r.trace.action}`);

  // 7. Deals (customer management read — coherent reply for live state)
  const d = await send('deals', 'deals');
  record('deals action', d.r.trace.action === 'deals', `action=${d.r.trace.action}`);
  record('deals coherent reply', d.r.text.length > 0, d.r.text.slice(0, 90));

  // 8. Knowledge search (live KB)
  const k = await send('search the knowledge base for TEOS DealMaker', 'knowledge search');
  record('knowledge intent', k.r.trace.action === 'knowledge', `action=${k.r.trace.action}`);
  record('knowledge returns hits', /\d+\./.test(k.r.text), k.r.text.slice(0, 120));

  // 9. Unknown request — no fallback
  const u = await send('asdkjhqwepo zxmnc', 'unknown');
  record('unknown handled', u.r.trace.intent === 'unknown' && u.r.trace.path === 'fast', `intent=${u.r.trace.intent} path=${u.r.trace.path}`);
  record('unknown no fallback text', u.fb.ok, u.fb.ok ? 'clean' : u.fb.hits.join(','));

  // 10. Talk to an agent (orchestrator)
  const t = await send('talk to the sales agent', 'talk to agent');
  record('agent talk resolved', t.r.trace.action === 'talk_to_agent', `action=${t.r.trace.action}`);

  // 11. Founder never sees billing
  const p = await send('show me pricing', 'pricing founder');
  record('pricing denied for founder', p.r.trace.decision === 'deny', `decision=${p.r.trace.decision}`);
  record('founder no billing text', !/upgrade|subscribe|\bpay\b|\$/.test(p.r.text), 'clean');

  // 12. Founder permission: diagnostics allowed
  const diag = await send('fix error', 'diagnostics founder');
  record('diagnostics allowed for founder', diag.r.trace.decision !== 'deny', `decision=${diag.r.trace.decision}`);

  // ---------------- latency summary (Priority 4 input)
  const fastMs = latencies.fast.filter(v => v != null);
  const slowMs = latencies.slow.filter(v => v != null);
  const avg = arr => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  console.log('\n------------------------------------------');
  console.log(`fast-path responses: ${fastMs.length}  (avg ${avg(fastMs) ?? 'n/a'} ms, ${fastMs.length ? 'max ' + Math.max(...fastMs) + ' ms' : ''})`);
  console.log(`slow-path responses: ${slowMs.length}  (avg ${avg(slowMs) ?? 'n/a'} ms, ${slowMs.length ? 'max ' + Math.max(...slowMs) + ' ms' : ''})`);
  console.log(`<300ms responses: ${[...fastMs, ...slowMs].filter(v => v < 300).length}/${[...fastMs, ...slowMs].length}`);
  console.log('------------------------------------------');

  const failed = results.filter(r => !r.ok);
  console.log(`\nRC1 CONVERSATION CHECK: ${results.length - failed.length}/${results.length} PASS`);
  await adapter.pool ? adapter.pool.end() : null;
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => {
  console.error('RC1 CONVO CHECK CRASHED:', err && err.stack ? err.stack : err);
  process.exit(2);
});
