'use strict';
// Independent OS process used by test-pg-lifecycle: own pg pool, own module state.
// argv: <eventId> [...]. Env: DATABASE_URL, OUTBOX_TEST_NOLOCK=1 (negative control).
process.env.NODE_ENV = 'test';
const db = require('../../db');
const outbox = require('../../services/auditOutbox');

// Widen the lookup->append window so an unlocked race is actually provoked.
if (process.env.OUTBOX_TEST_SLOW === '1') {
  const audit = require('../../utils/auditLogger');
  const real = audit.findByEventId;
  audit.findByEventId = id => { const r = real(id); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40); return r; };
}

(async () => {
  const adapter = db.createPgAdapter();
  if (process.env.OUTBOX_TEST_NOLOCK === '1') {
    adapter.withAdvisoryLock = async (_n, fn) => ({ acquired: true, value: await fn() });
  }
  const out = [];
  for (const id of process.argv.slice(2)) out.push(await outbox.deliverByEventId(adapter, id));
  console.log('RESULT ' + JSON.stringify(out.map(r => ({ ok: r.ok, state: r.state, code: r.code || null }))));
  await db.getPool().end();
  process.exit(0);
})().catch(err => { console.error('CHILD_ERROR ' + err.message); process.exit(1); });
