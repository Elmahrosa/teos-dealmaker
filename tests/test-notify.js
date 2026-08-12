// services/notify.js test — Slack + email reporting wired to the event bus.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || '';

const assert = require('assert');
const { createNotifier, EVENT_NAMES } = require('../services/notify');
const events = require('../services/workforce/events');

(async () => {
  let n = 0;
  const check = (cond, msg) => { assert.ok(cond, msg); n += 1; };
  const equal = (a, b, msg) => { assert.strictEqual(a, b, msg); n += 1; };

  // ----------------------------------------- Unconfigured -> inert, safe
  const n1 = createNotifier({ log: () => {} });
  const s1 = await n1.postSlack('hello');
  equal(s1.skipped, true, 'slack skipped when no webhook configured');
  const e1 = await n1.postEmail('subject', 'body');
  equal(e1.skipped, true, 'email skipped when no transport configured');

  // ----------------------------------------- Configured -> delivered
  const n2 = createNotifier({
    slackWebhookUrl: 'https://hooks.slack.test/x',
    emailWebhookUrl: 'https://email.test/x',
    emailTo: 'founder@elmahrosa.org',
    fetch: async () => ({ ok: true, status: 200 }),
    log: () => {}
  });
  const s2 = await n2.postSlack('mission completed');
  equal(s2.skipped, false, 'slack delivered when webhook configured');
  equal(s2.ok, true, 'slack delivery ok');
  const e2 = await n2.postEmail('M', 'body');
  equal(e2.skipped, false, 'email delivered when transport configured');

  // ----------------------------------------- Event bus wiring
  events.clear();
  const n3 = createNotifier({
    slackWebhookUrl: 'https://hooks.slack.test/x',
    fetch: async () => ({ ok: true, status: 200 }),
    log: () => {}
  });
  const inst = n3.install();
  equal(inst.ok, true, 'notifier installed on the event bus');
  const again = n3.install();
  equal(again.ok, false, 'install is idempotent');

  events.emit(EVENT_NAMES.PLAN_COMPLETED, { planId: 1, title: 'Sell TEOS DealMaker', metrics: { completed_steps: 13, total_steps: 13, avg_confidence: 0.94 } });
  events.emit(EVENT_NAMES.APPROVAL_REQUESTED, { approvalId: 7, stepId: 3, agentType: 'gatekeeper', reason: 'Requires founder approval' });
  await new Promise(r => setTimeout(r, 30));
  check(n3.sent.length >= 2, 'event emissions triggered notifications');
  check(n3.sent.some(p => p.channel === 'slack' && /Sell TEOS DealMaker/.test(p.text)), 'mission completion reported to slack');

  console.log(`\nPASS ${n} assertions (test-notify)`);
  process.exit(0);
})().catch(err => {
  console.error('test-notify FAILED:', err && err.stack || err);
  process.exit(1);
});

