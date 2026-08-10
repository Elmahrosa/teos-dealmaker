const assert = require('assert');
const crypto = require('crypto');

(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.DODO_WEBHOOK_SECRET;
  delete process.env.DODO_STARTER_MONTHLY_PID;
  delete process.env.DODO_GROWTH_MONTHLY_PID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TEOS_FOUNDER_TELEGRAM_ID;

  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };
  const eq = (a, b, label) => { assert.strictEqual(a, b, label); passed += 1; };

  console.log('\n=== Billing · Phase 5C Dodo webhook pipeline ===');

  const { createMemoryAdapter, createRepos } = require('../db');
  const billing = require('../services/billing');

  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  // ---------------------------------------------------- seed workspace + sub
  const ws = repos.workspaces.create({ name: 'Acme', slug: 'acme-bill', plan: 'solo', status: 'active' });
  const sub = repos.subscriptions.create({ workspace_id: ws.id, plan: 'solo', status: 'pending', cycle: 'monthly', provider: 'dodo', provider_customer_id: null });

  // ------------------------------------------ 1. signature verification
  const secret = 'test_webhook_secret_123';
  process.env.DODO_WEBHOOK_SECRET = secret;
  const body = JSON.stringify({ event_type: 'test', data: {} });
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

  const good = billing.verifySignature(body, sig);
  ok(good.ok, 'verifySignature accepts valid HMAC-SHA256');

  const bad = billing.verifySignature(body, 'sha256=deadbeef');
  ok(!bad.ok, 'verifySignature rejects invalid signature');

  const missing = billing.verifySignature(body, '');
  ok(!missing.ok, 'verifySignature rejects missing signature');

  // ------------------------------------------ 2. fail closed when no secret
  delete process.env.DODO_WEBHOOK_SECRET;
  const noSecret = billing.verifySignature(body, sig);
  ok(!noSecret.ok && noSecret.reason === 'webhook_secret_not_configured',
    'verifySignature fails closed when DODO_WEBHOOK_SECRET unset');
  const noSecretMissing = billing.verifySignature(body, '');
  ok(!noSecretMissing.ok, 'verifySignature rejects even unsigned requests without a secret');

  // ------------------------------------------ 3. product → plan mapping
  process.env.DODO_STARTER_MONTHLY_PID = 'pid_starter_m';
  process.env.DODO_GROWTH_MONTHLY_PID = 'pid_growth_m';

  eq(billing.getPlanForProduct('pid_starter_m'), 'solo', 'getPlanForProduct maps starter → solo');
  eq(billing.getPlanForProduct('pid_growth_m'), 'growth', 'getPlanForProduct maps growth → growth');
  eq(billing.getPlanForProduct('unknown_pid'), null, 'getPlanForProduct returns null for unknown');

  // ------------------------------------------ 4. subscription.created
  const created = await billing.handleEvent(adapter, 'subscription.created', {
    customer_id: 'cust_abc123',
    product_id: 'pid_starter_m',
    billing_cycle: 'monthly',
    metadata: { workspace_id: String(ws.id) }
  });
  ok(created.ok, 'subscription.created returns ok');
  eq(created.plan, 'solo', 'subscription.created sets plan to solo');

  const wsAfter = repos.workspaces.get(ws.id);
  eq(wsAfter.plan, 'solo', 'workspace plan updated to solo');
  eq(wsAfter.status, 'active', 'workspace status set to active');

  const subAfter = repos.subscriptions.get(ws.id);
  ok(subAfter && subAfter.status === 'active', 'subscription status set to active');
  ok(subAfter && subAfter.cycle === 'monthly', 'subscription cycle is monthly');
  ok(subAfter && subAfter.renewal_date, 'subscription renewal_date set');
  ok(subAfter && subAfter.provider_customer_id === 'cust_abc123', 'provider_customer_id stored');

  // ------------------------------------------ 5. subscription.renewed
  const renewed = await billing.handleEvent(adapter, 'subscription.renewed', {
    customer_id: 'cust_abc123',
    billing_cycle: 'monthly'
  });
  ok(renewed.ok, 'subscription.renewed returns ok');

  const subRenewed = repos.subscriptions.get(ws.id);
  ok(subRenewed && subRenewed.status === 'active', 'renewed subscription stays active');
  ok(subRenewed && subRenewed.renewal_date > '2025-01-01', 'renewal_date updated');

  // ------------------------------------------ 6. payment.succeeded
  const paid = await billing.handleEvent(adapter, 'payment.succeeded', {
    customer_id: 'cust_abc123',
    amount: 7900,
    currency: 'USD'
  });
  ok(paid.ok, 'payment.succeeded returns ok');
  eq(paid.workspaceId, ws.id, 'payment.succeeded resolves workspace');

  // ------------------------------------------ 7. payment.failed → past_due
  const failed = await billing.handleEvent(adapter, 'payment.failed', {
    customer_id: 'cust_abc123'
  });
  ok(failed.ok, 'payment.failed returns ok');

  const subPastDue = repos.subscriptions.get(ws.id);
  ok(subPastDue && subPastDue.status === 'past_due', 'payment.failed sets subscription to past_due');

  // Restore to active for further tests
  repos.subscriptions.update(sub.id, { status: 'active' });

  // ------------------------------------------ 8. subscription.upgraded
  process.env.DODO_GROWTH_MONTHLY_PID = 'pid_growth_m';
  const upgraded = await billing.handleEvent(adapter, 'subscription.upgraded', {
    customer_id: 'cust_abc123',
    product_id: 'pid_growth_m'
  });
  ok(upgraded.ok, 'subscription.upgraded returns ok');
  eq(upgraded.plan, 'growth', 'upgraded plan is growth');

  const wsUpgraded = repos.workspaces.get(ws.id);
  eq(wsUpgraded.plan, 'growth', 'workspace plan updated to growth');

  // ------------------------------------------ 9. subscription.downgraded
  const downgraded = await billing.handleEvent(adapter, 'subscription.downgraded', {
    customer_id: 'cust_abc123',
    product_id: 'pid_starter_m'
  });
  ok(downgraded.ok, 'subscription.downgraded returns ok');
  eq(downgraded.plan, 'solo', 'downgraded plan is solo');

  // ------------------------------------------ 10. subscription.cancelled
  const cancelled = await billing.handleEvent(adapter, 'subscription.cancelled', {
    customer_id: 'cust_abc123'
  });
  ok(cancelled.ok, 'subscription.cancelled returns ok');

  const subCancelled = repos.subscriptions.get(ws.id);
  ok(subCancelled && subCancelled.status === 'cancelled', 'cancelled subscription status is cancelled');

  const wsCancelled = repos.workspaces.get(ws.id);
  eq(wsCancelled.plan, 'solo', 'workspace plan retained on cancel');

  // ------------------------------------------ 11. refund.success
  const refund = await billing.handleEvent(adapter, 'refund.success', {
    customer_id: 'cust_abc123',
    amount: 7900,
    currency: 'USD'
  });
  ok(refund.ok, 'refund.success returns ok');
  eq(refund.workspaceId, ws.id, 'refund resolves workspace');

  // ------------------------------------------ 12. unhandled event type
  const unhandled = await billing.handleEvent(adapter, 'invoice.overdue', { customer_id: 'x' });
  ok(unhandled.ok && unhandled.skipped, 'unhandled event type returns skipped');

  // ------------------------------------------ 13. subscription.created via metadata fallback
  const ws2 = repos.workspaces.create({ name: 'Bob Co', slug: 'bob-bill', plan: 'solo', status: 'active' });
  const created2 = await billing.handleEvent(adapter, 'subscription.created', {
    customer_id: 'cust_new',
    product_id: 'pid_growth_m',
    billing_cycle: 'monthly',
    metadata: { workspace_id: String(ws2.id) }
  });
  ok(created2.ok, 'subscription.created with metadata fallback ok');
  eq(created2.plan, 'growth', 'metadata-fallback subscription uses correct plan');

  const ws2After = repos.workspaces.get(ws2.id);
  eq(ws2After.plan, 'growth', 'workspace2 plan set to growth via metadata');

  // ------------------------------------------ 14. audit trail
  const entries = repos.audit.list(ws.id);
  ok(entries.length >= 7, 'audit trail has entries for all billing events');

  const actionTypes = entries.map(e => e.action_type);
  ok(actionTypes.includes('SUBSCRIPTION_CREATED'), 'audit: SUBSCRIPTION_CREATED');
  ok(actionTypes.includes('SUBSCRIPTION_RENEWED'), 'audit: SUBSCRIPTION_RENEWED');
  ok(actionTypes.includes('PAYMENT_SUCCEEDED'), 'audit: PAYMENT_SUCCEEDED');
  ok(actionTypes.includes('PAYMENT_FAILED'), 'audit: PAYMENT_FAILED');
  ok(actionTypes.includes('SUBSCRIPTION_UPGRADED'), 'audit: SUBSCRIPTION_UPGRADED');
  ok(actionTypes.includes('SUBSCRIPTION_DOWNGRADED'), 'audit: SUBSCRIPTION_DOWNGRADED');
  ok(actionTypes.includes('SUBSCRIPTION_CANCELLED'), 'audit: SUBSCRIPTION_CANCELLED');
  ok(actionTypes.includes('REFUND_ISSUED'), 'audit: REFUND_ISSUED');

  // ------------------------------------------ 15. webhook handler count
  const handlerCount = Object.keys(billing.EVENT_HANDLERS).length;
  eq(handlerCount, 8, 'EVENT_HANDLERS has 8 registered event types');

  // ------------------------------------------ 16. mission tracking: isEntitled function
  // Founder plan should always be entitled (unlimited missions)
  const founderWs = repos.workspaces.create({ name: 'Founder Corp', slug: 'founder-corp', plan: 'founder', status: 'active' });
  ok(await billing.isEntitled(adapter, founderWs.id), 'founder workspace entitled without subscription');

  // Create a subscription for testing
  const testWs = repos.workspaces.create({ name: 'TestCorp', slug: 'testcorp', plan: 'solo', status: 'active' });
  const testSub = repos.subscriptions.create({
    workspace_id: testWs.id,
    plan: 'solo',
    status: 'active',
    cycle: 'monthly',
    provider: 'dodo',
    provider_customer_id: 'test_cust_123',
    missions_used: 0
  });

  // Test isEntitled with active subscription and missions under limit
  ok(await billing.isEntitled(adapter, testWs.id), 'active subscription with 0 missions used is entitled');

  // Test isEntitled with missions at limit (should not be entitled)
  await repos.subscriptions.update(testSub.id, { missions_used: 5 }); // solo plan limit is 5
  ok(!(await billing.isEntitled(adapter, testWs.id)), 'subscription at mission limit is not entitled');

  // Test isEntitled with missions over limit (should not be entitled)
  await repos.subscriptions.update(testSub.id, { missions_used: 6 });
  ok(!(await billing.isEntitled(adapter, testWs.id)), 'subscription over mission limit is not entitled');

  // Test isEntitled with inactive subscription (should not be entitled)
  await repos.subscriptions.update(testSub.id, { status: 'cancelled', missions_used: 0 });
  ok(!(await billing.isEntitled(adapter, testWs.id)), 'subscription with cancelled status is not entitled');

  // Test isEntitled on growth plan with various mission counts
  const growthWs = repos.workspaces.create({ name: 'GrowthInc', slug: 'growthinc', plan: 'growth', status: 'active' });
  const growthSub = repos.subscriptions.create({
    workspace_id: growthWs.id,
    plan: 'growth',
    status: 'active',
    cycle: 'monthly',
    provider: 'dodo',
    provider_customer_id: 'cust_456',
    missions_used: 0
  });

  // Under limit (20 for growth plan)
  ok(await billing.isEntitled(adapter, growthWs.id), 'growth plan with 0 missions used is entitled');

  await repos.subscriptions.update(growthSub.id, { missions_used: 19 });
  ok(await billing.isEntitled(adapter, growthWs.id), 'growth plan with 19 missions used is entitled');

  // At limit
  await repos.subscriptions.update(growthSub.id, { missions_used: 20 });
  ok(!(await billing.isEntitled(adapter, growthWs.id)), 'growth plan at mission limit is not entitled');

  // Test isEntitled on corporate plan (limit 100)
  const corpWs = repos.workspaces.create({ name: 'CorpLtd', slug: 'corpltd', plan: 'corporate', status: 'active' });
  const corpSub = repos.subscriptions.create({
    workspace_id: corpWs.id,
    plan: 'corporate',
    status: 'active',
    cycle: 'monthly',
    provider: 'dodo',
    provider_customer_id: 'cust_789',
    missions_used: 0
  });

  ok(await billing.isEntitled(adapter, corpWs.id), 'corporate plan with 0 missions used is entitled');

  await repos.subscriptions.update(corpSub.id, { missions_used: 99 });
  ok(await billing.isEntitled(adapter, corpWs.id), 'corporate plan with 99 missions used is entitled');

  await repos.subscriptions.update(corpSub.id, { missions_used: 100 });
  ok(!(await billing.isEntitled(adapter, corpWs.id)), 'corporate plan at mission limit is not entitled');

  // Test isEntitled on trial plan (limit 1)
  const trialWs = repos.workspaces.create({ name: 'TrialLLC', slug: 'trial-llc', plan: 'trial', status: 'active' });
  const trialSub = repos.subscriptions.create({
    workspace_id: trialWs.id,
    plan: 'trial',
    status: 'active',
    cycle: 'monthly',
    provider: 'dodo',
    provider_customer_id: 'cust_abc',
    missions_used: 0
  });

  ok(await billing.isEntitled(adapter, trialWs.id), 'trial plan with 0 missions used is entitled');

  await repos.subscriptions.update(trialSub.id, { missions_used: 1 });
  ok(!(await billing.isEntitled(adapter, trialWs.id)), 'trial plan at mission limit is not entitled');

  // ------------------------------------------ 17. mission tracking: incrementMissionsUsed function
  // Test incrementing missions used
  const incrementWs = repos.workspaces.create({ name: 'IncrementInc', slug: 'incrementinc', plan: 'solo', status: 'active' });
  const incrementSub = repos.subscriptions.create({
    workspace_id: incrementWs.id,
    plan: 'solo',
    status: 'active',
    cycle: 'monthly',
    provider: 'dodo',
    provider_customer_id: 'cust_inc',
    missions_used: 2
  });

  // Increment by 1 (default)
  await billing.incrementMissionsUsed(adapter, incrementWs.id);
  const afterIncrement = repos.subscriptions.get(incrementWs.id);
  ok(afterIncrement && afterIncrement.missions_used === 3, 'incrementMissionsUsed increases count by 1');

  // Increment by 3
  await billing.incrementMissionsUsed(adapter, incrementWs.id, 3);
  const afterIncrement3 = repos.subscriptions.get(incrementWs.id);
  ok(afterIncrement3 && afterIncrement3.missions_used === 6, 'incrementMissionsUsed increases count by specified amount');

  // Test that increment works on founder plan (should not cause issues even though unlimited)
  await billing.incrementMissionsUsed(adapter, founderWs.id); // founder workspace
  const founderSub = repos.subscriptions.get(founderWs.id);
  ok(!founderSub || founderSub.missions_used === 0, 'founder plan missions_used remains 0 (unlimited)');

  // Test increment on non-existent subscription (should not throw)
  const fakeWs = repos.workspaces.create({ name: 'FakeInc', slug: 'fakeinc', plan: 'solo', status: 'active' });
  // Don't create subscription for this workspace
  await billing.incrementMissionsUsed(adapter, fakeWs.id); // Should not throw
  ok(true, 'incrementMissionsUsed handles missing subscription gracefully');

  console.log(`\n✓ tests/test-billing.js — ${passed} assertions passed`);
  process.exit(0);
})().catch(err => {
  console.error('TEST FAILED:', err.message);
  process.exit(1);
});
