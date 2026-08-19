const assert = require('assert');

(async () => {
  // Clear environment variables that might affect tests
  delete process.env.DATABASE_URL;
  delete process.env.DODO_WEBHOOK_SECRET;
  delete process.env.DODO_STARTER_MONTHLY_PID;
  delete process.env.DODO_GROWTH_MONTHLY_PID;
  delete process.env.DODO_BUSINESS_MONTHLY_PID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TEOS_FOUNDER_TELEGRAM_ID;
  delete process.env.BILLING_MODE;

  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };
  const eq = (a, b, label) => { assert.strictEqual(a, b, label); passed += 1; };

  console.log('\n=== Billing · Manual Pilot Mode Tests ===');

  const { createMemoryAdapter, createRepos } = require('../db');
  const billing = require('../services/billing');
  const billingConfig = require('../config/billing');

  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  // ------------------------------------------ 1. Test billing mode configuration
  console.log('\n--- Testing billing mode configuration ---');

  // Test default mode is dodo
  eq(billingConfig.getMode(), 'dodo', 'Default billing mode is dodo');
  ok(billingConfig.isDodo(), 'isDodo() returns true for default mode');
  ok(!billingConfig.isManualPilot(), 'isManualPilot() returns false for default mode');
  ok(!billingConfig.isTrial(), 'isTrial() returns false for default mode');

  // Test setting mode to manual_pilot
  billingConfig.setMode('manual_pilot');
  eq(billingConfig.getMode(), 'manual_pilot', 'Billing mode can be set to manual_pilot');
  ok(billingConfig.isManualPilot(), 'isManualPilot() returns true for manual_pilot mode');
  ok(!billingConfig.isDodo(), 'isDodo() returns false for manual_pilot mode');
  ok(!billingConfig.isTrial(), 'isTrial() returns false for manual_pilot mode');

  // Test setting mode back to dodo
  billingConfig.setMode('dodo');
  eq(billingConfig.getMode(), 'dodo', 'Billing mode can be set back to dodo');
  ok(billingConfig.isDodo(), 'isDodo() returns true for dodo mode');
  ok(!billingConfig.isManualPilot(), 'isManualPilot() returns false for dodo mode');

  // Test invalid mode
  try {
    billingConfig.setMode('invalid_mode');
    ok(false, 'Setting invalid mode should throw');
  } catch (err) {
    ok(err instanceof Error, 'Setting invalid mode throws Error');
    ok(err.message.includes('Billing mode must be one of'), 'Error message is correct');
  }

  // ------------------------------------------ 2. Test requiresDodoCredentials function
  console.log('\n--- Testing requiresDodoCredentials function ---');

  // Test in dodo mode
  billingConfig.setMode('dodo');
  ok(billingConfig.requiresDodoCredentials(), 'requiresDodoCredentials() returns true in dodo mode');

  // Test in manual_pilot mode
  billingConfig.setMode('manual_pilot');
  ok(!billingConfig.requiresDodoCredentials(), 'requiresDodoCredentials() returns false in manual_pilot mode');

  // Test in trial mode
  billingConfig.setMode('trial');
  ok(!billingConfig.requiresDodoCredentials(), 'requiresDodoCredentials() returns false in trial mode');

  // ------------------------------------------ 3. Test isEntitled with manual_pilot mode
  console.log('\n--- Testing isEntitled with manual_pilot mode ---');

  // Test workspace without manual pilot activation (should not be entitled)
  const wsNoActivation = repos.workspaces.create({
    name: 'NoActivation Inc',
    slug: 'no-activation-inc',
    plan: 'manual_pilot',
    status: 'active'
  });

  // Manually update the workspace plan since isEntitled checks workspace.plan
  await repos.workspaces.update(wsNoActivation.id, { plan: 'manual_pilot' });

  const entitledNoActivation = await billing.isEntitled(adapter, wsNoActivation.id);
  ok(!entitledNoActivation, 'Workspace with manual_pilot plan but no activation is not entitled');

  // Test workspace with manual pilot activation (should be entitled)
  const wsWithActivation = repos.workspaces.create({
    name: 'WithActivation Inc',
    slug: 'with-activation-inc',
    plan: 'manual_pilot',
    status: 'active'
  });

  // Manually update the workspace plan
  await repos.workspaces.update(wsWithActivation.id, { plan: 'manual_pilot' });

  // Create manual pilot activation
  await repos.manualPilotActivations.create({
    workspace_id: wsWithActivation.id,
    activated_by: 'founder_123',
    plan: 'manual_pilot',
    notes: 'Test manual pilot activation'
  });

  const entitledWithActivation = await billing.isEntitled(adapter, wsWithActivation.id);
  ok(entitledWithActivation, 'Workspace with manual_pilot plan and activation is entitled');

  // Test workspace with deactivated manual pilot activation (should not be entitled)
  await repos.manualPilotActivations.deactivate(wsWithActivation.id);
  const entitledDeactivated = await billing.isEntitled(adapter, wsWithActivation.id);
  ok(!entitledDeactivated, 'Workspace with manual_pilot plan but deactivated activation is not entitled');

  // Test that founder plan still works in manual_pilot mode
  billingConfig.setMode('manual_pilot');
  const founderWs = repos.workspaces.create({
    name: 'Founder Corp',
    slug: 'founder-corp',
    plan: 'founder',
    status: 'active'
  });
  const founderEntitled = await billing.isEntitled(adapter, founderWs.id);
  ok(founderEntitled, 'Founder workspace is entitled regardless of billing mode');

  // ------------------------------------------ 4. Test handleManualPilotActivated event handler
  console.log('\n--- Testing handleManualPilotActivated event handler ---');

  billingConfig.setMode('dodo'); // Reset to dodo mode for this test

  const wsForActivation = repos.workspaces.create({
    name: 'Activation Test Inc',
    slug: 'activation-test-inc',
    plan: 'solo',
    status: 'active'
  });

  const activationData = {
    workspace_id: wsForActivation.id,
    activated_by: 'founder_456',
    plan: 'manual_pilot',
    notes: 'Test activation via event handler'
  };

  const result = await billing.handleEvent(adapter, 'manual_pilot.activated', activationData);
  ok(result.ok, 'manual_pilot.activated event returns ok');
  eq(result.workspaceId, wsForActivation.id, 'manual_pilot.activated event returns correct workspaceId');
  eq(result.plan, 'manual_pilot', 'manual_pilot.activated event returns correct plan');

  // Verify workspace plan was updated
  const wsAfterActivation = repos.workspaces.get(wsForActivation.id);
  eq(wsAfterActivation.plan, 'manual_pilot', 'Workspace plan updated to manual_pilot after activation');

  // Verify activation record exists
  const activationRecord = await repos.manualPilotActivations.getActiveByWorkspace(wsForActivation.id);
  ok(activationRecord !== null, 'Activation record exists after manual_pilot.activated event');
  eq(activationRecord.activated_by, 'founder_456', 'Activation record has correct activated_by');
  eq(activationRecord.plan, 'manual_pilot', 'Activation record has correct plan');
  eq(activationRecord.notes, 'Test activation via event handler', 'Activation record has correct notes');
  ok(activationRecord.status === 'active', 'Activation record has active status');

  // Verify audit entry was created
  const auditEntries = repos.audit.list(wsForActivation.id);
  const manualPilotAudit = auditEntries.find(entry => entry.action_type === 'MANUAL_PILOT_ACTIVATED');
  ok(manualPilotAudit !== null, 'Audit entry created for MANUAL_PILOT_ACTIVATED');
  ok(manualPilotAudit.details.workspaceId === wsForActivation.id, 'Audit entry has correct workspaceId');
  ok(manualPilotAudit.details.activatedBy === 'founder_456', 'Audit entry has correct activatedBy');
  ok(manualPilotAudit.details.plan === 'manual_pilot', 'Audit entry has correct plan');

  // ------------------------------------------ 5. Test isEntitled after activation in different billing modes
  console.log('\n--- Testing isEntitled after activation in different billing modes ---');

  // Test in dodo mode (should still work because activation overrides plan check)
  billingConfig.setMode('dodo');
  const entitledInDodoMode = await billing.isEntitled(adapter, wsForActivation.id);
  ok(entitledInDodoMode, 'Workspace is entitled in dodo mode after manual pilot activation');

  // Test in trial mode
  billingConfig.setMode('trial');
  const entitledInTrialMode = await billing.isEntitled(adapter, wsForActivation.id);
  ok(entitledInTrialMode, 'Workspace is entitled in trial mode after manual pilot activation');

  // Test in manual_pilot mode
  billingConfig.setMode('manual_pilot');
  const entitledInManualPilotMode = await billing.isEntitled(adapter, wsForActivation.id);
  ok(entitledInManualPilotMode, 'Workspace is entitled in manual_pilot mode after manual pilot activation');

  // ------------------------------------------ 6. Test deactivation
  console.log('\n--- Testing manual pilot deactivation ---');

  // Deactivate the manual pilot
  const deactivationResult = await repos.manualPilotActivations.deactivate(wsForActivation.id);
  ok(deactivationResult !== null, 'Deactivation returns result');

  // Verify activation is deactivated
  const deactivatedActivation = await repos.manualPilotActivations.getActiveByWorkspace(wsForActivation.id);
  ok(deactivatedActivation === null, 'No active activation after deactivation');

  // Verify isEntitled returns false after deactivation
  const entitledAfterDeactivation = await billing.isEntitled(adapter, wsForActivation.id);
  ok(!entitledAfterDeactivation, 'Workspace is not entitled after manual pilot deactivation');

  // Verify audit entry for deactivation would be handled elsewhere (not in billing service)

  // ------------------------------------------ 7. Test EVENT_HANDLERS includes manual_pilot.activated
  console.log('\n--- Testing EVENT_HANDLERS ---');

  const handlerCount = Object.keys(billing.EVENT_HANDLERS).length;
  eq(handlerCount, 9, 'EVENT_HANDLERS has 9 registered event types (including manual_pilot.activated)');
  ok(typeof billing.EVENT_HANDLERS['manual_pilot.activated'] === 'function', 'manual_pilot.activated handler is registered');

  console.log(`\n✓ tests/test-manual-pilot-billing.js — ${passed} assertions passed`);
  process.exit(0);
})().catch(err => {
  console.error('TEST FAILED:', err.message);
  process.exit(1);
});
