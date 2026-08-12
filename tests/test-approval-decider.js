// Regression: an approval decided by the founder's raw Telegram ID must be
// stored as the internal users.id — never the Telegram ID itself, which
// exceeds the INTEGER range of approval_requests.decided_by (and previously
// surfaced in production as `[bot] callback error: value "7815071893" is out
// of range for type integer`). See services/workforce/approvals.js decide().
const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');
const runtime = require('../services/workforce/runtime');
const approvals = require('../services/workforce/approvals');

(async () => {
  let n = 0;
  const equal = (a, b, msg) => { assert.strictEqual(a, b, msg); n += 1; };
  const check = (cond, msg) => { assert.ok(cond, msg); n += 1; };

  const adapter = createMemoryAdapter();
  const FOUNDER_TG = 7815071893;
  await identity.ensureUser(adapter, FOUNDER_TG, { display_name: 'Elmahrosa' });
  const founder = await identity.getUserByTelegram(adapter, FOUNDER_TG);
  equal(typeof founder.id, 'number', 'founder resolved to an internal user id');

  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: founder.id,
    companyName: 'Approval Decider Regression',
    lang: 'en',
    plan: 'growth'
  });
  const wsId = ws.id;
  const repos = createRepos(adapter);

  // Activate subscription for growth plan (simulate webhook)
  const sub = await repos.subscriptions.get(wsId);
  await repos.subscriptions.update(sub.id, { status: 'active' });

  const outcome = await runtime.runGoal(
    adapter,
    wsId,
    'Prepare and send a proposal to Regression Corp',
    { title: 'Regression proposal' }
  );
  equal(outcome.status, 'waiting_approval', 'proposal halts for approval');
  equal(outcome.pendingApprovals.length, 1, 'one approval request pending');
  const requestId = outcome.pendingApprovals[0].requestId;

  const decided = await approvals.decide(adapter, wsId, requestId, 'approve', FOUNDER_TG);
  equal(decided.status, 'approved', 'request approved');
  equal(decided.decided_by, founder.id, 'decided_by stores the internal users.id, not the raw Telegram ID');

  const stored = await repos.approvals.get(wsId, requestId);
  check(Number(stored.decided_by) < 2147483647, 'decided_by fits in INTEGER range');
  equal(stored.decided_by, founder.id, 'persisted decided_by matches internal user id');

  console.log(`\n✓ approval decider maps Telegram ID → internal users.id (${n} assertions passed)`);
  console.log('  regression: decided_by overflow (7815071893 > INTEGER max)');
})().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});

