'use strict';
// Runs the dashboards' real fetchJson against a fake fetch: the body must be
// resolved (not a Promise), and failures must degrade to { ok:false, body:null }.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n += 1; };
const root = path.join(__dirname, '..');
const files = ['public/dashboard/index.html', 'hostinger/dashboard/index.html', 'server/sentinel.html'];

(async () => {
  for (const f of files) {
    const html = fs.readFileSync(path.join(root, f), 'utf8');
    const m = html.match(/function fetchJson\(path, opts\) \{[\s\S]*?\n {2}\}\n/);
    ok(m, `${f}: fetchJson found`);
    const mk = (fake) => { const ctx = { fetch: fake }; vm.createContext(ctx); vm.runInContext(m[0] + '\nthis.fetchJson = fetchJson;', ctx); return ctx.fetchJson; };

    let r = await mk(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'ok' }) }))('/x');
    ok(r.ok === true && r.status === 200, `${f}: ok response`);
    ok(!(r.body && typeof r.body.then === 'function') && r.body.status === 'ok', `${f}: body is resolved data, not a Promise`);

    r = await mk(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('not json')) }))('/x');
    ok(r.ok === false && r.status === 502 && r.body === null, `${f}: non-JSON body becomes null`);

    r = await mk(() => Promise.reject(new Error('network')))('/x');
    ok(r.ok === false && r.status === 0 && r.body === null, `${f}: network failure degrades safely`);

    ok(/data-i18n="mode">Service Status</.test(html) && !/health\.mode/.test(html), `${f}: tile is labelled Service Status`);
    ok(/modeEl\.textContent = publicMode\(\);\s*modeEl\.className = 'ok'/.test(html), `${f}: operational pill uses neutral ok styling, not DRY/LIVE`);
  }
  console.log(`PASS: dashboard fetchJson and status label (${n} assertions)`);
})().catch(e => { console.error(e); process.exit(1); });
