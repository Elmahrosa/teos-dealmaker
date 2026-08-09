const { createMemoryAdapter } = require('../db/adapter');
const dealSimulation = require('../services/dealSimulation');
const negotiationRehearsal = require('../services/negotiationRehearsal');
const interviewService = require('../services/interviewService');
const reportAgent = require('../services/reportAgent');

async function runConsequentialActionTests() {
  console.log('Testing Consequential Action Isolation...\n');

  // Setup
  const adapter = createMemoryAdapter();

  // Create a test workspace and deal
  const workspaceResult = await adapter.insert('workspaces', { name: 'Test Workspace', slug: 'test', plan: 'solo' });
  const workspaceId = workspaceResult.id;
  const dealResult = await adapter.insert('deals', { id: 1, workspace_id: workspaceId, company_name: 'Test Corp', stage: 'negotiation', status: 'open' });
  const dealId = dealResult.id;

  let allPassed = true;

  // Test 1: Simulation outputs should not trigger email sending
  console.log('Test 1: Verifying simulation outputs cannot trigger email sending');
  try {
    // Get simulation results
    const stakeholderIntel = await dealSimulation.buildStakeholderIntelligence(adapter, workspaceId, dealId);
    const report = await reportAgent.generateReport(adapter, workspaceId, dealId);

    // Check that outputs are analysis/recommendation/drafts, not execution commands
    const hasExecutionCommands = checkForExecutionCommands(JSON.stringify({ stakeholderIntel, report }));

    if (!hasExecutionCommands) {
      console.log('   ����� ��� ��� � ��� � � ✓ Simulation outputs contain no execution commands (only analysis/recommendations)');
    } else {
      console.error('   ����� ��� ��� � ��� � � ✗ Simulation outputs contain execution commands');
      allPassed = false;
    }
  } catch (error) {
    console.error(`   ����� ��� ��� � ��� � � ✗ Error checking simulation outputs: ${error.message}`);
    allPassed = false;
  }

  // Test 2: Verify simulation cannot create payments
  console.log('\nTest 2: Verifying simulation cannot create payments');
  try {
    // Try to extract any payment-related actions from simulation outputs
    const stakeholderIntel = await dealSimulation.buildStakeholderIntelligence(adapter, workspaceId, dealId);
    const paymentRelated = checkForPaymentActions(JSON.stringify(stakeholderIntel));

    if (!paymentRelated) {
      console.log('   ����� ��� ��� � ��� � � ✓ No payment creation actions found in simulation outputs');
    } else {
      console.error('   ����� ��� ��� ��� ��� � � � Payment creation actions detected in simulation outputs');
      allPassed = false;
    }
  } catch (error) {
    console.error(`   ����� ��� ��� ��� ��� � � � Error checking for payment actions: ${error.message}`);
    allPassed = false;
  }

  // Test 3: Verify simulation cannot approve deals or modify entitlements
  console.log('\nTest 3: Verifying simulation cannot approve deals or modify entitlements');
  try {
    const negotiationResult = await negotiationRehearsal.startRehearsal(adapter, workspaceId, dealId, 'test_user');
    const interviewResult = await interviewService.startInterview(adapter, workspaceId, dealId, 'test_user');

    const outputs = JSON.stringify({ negotiationResult, interviewResult });
    const approvalActions = checkForApprovalActions(outputs);
    const entitlementActions = checkForEntitlementActions(outputs);

    if (!approvalActions && !entitlementActions) {
      console.log('   ����� ��� ��� ��� � ��� � � � ✓ No approval or entitlement modification actions found');
    } else {
      console.error('   ����� ��� ��� ��� ��� ��� � � � � Approval or entitlement actions detected in simulation outputs');
      allPassed = false;
    }
  } catch (error) {
    console.error(`   ����� ��� ��� ��� ��� ��� � � � � Error checking approval/entitlement actions: ${error.message}`);
    allPassed = false;
  }

  // Test 4: Verify simulation cannot bypass Sentinel or authorization
  console.log('\nTest 4: Verifying simulation cannot bypass security controls');
  try {
    const report = await reportAgent.generateReport(adapter, workspaceId, dealId);
    const bypassActions = checkForSecurityBypassActions(JSON.stringify(report));

    if (!bypassActions) {
      console.log('   ����� ��� ��� ��� ��� � ��� � � � � ✓ No security bypass actions found in simulation outputs');
    } else {
      console.error('   ����� ��� ��� ��� ��� ��� ��� � � � � � Security bypass actions detected in simulation outputs');
      allPassed = false;
    }
  } catch (error) {
    console.error(`   ����� ��� ��� ��� ��� ��� ��� � � � � � Error checking security bypass: ${error.message}`);
    allPassed = false;
  }

  // Test 5: Verify the actual execution path remains intact
  console.log('\nTest 5: Verifying normal execution path remains intact');
  try {
    // Test that the original negotiator function still works
    const { buildTerms } = require('../agents/negotiator');
    const testLead = { id: 'lead_001', company: 'Test Corp' };
    const terms = buildTerms(testLead, 25000, 20000);

    if (terms && typeof terms === 'object' && terms.feasible !== undefined) {
      console.log('   ����� ��� ��� ��� ��� ��� � ��� � � � � � ✓ Original negotiator execution path intact');
    } else {
      console.error('   ����� ��� ��� ��� ��� ��� ��� ��� � � � � � � Original negotiator execution path broken');
      allPassed = false;
    }

    // Test that simulation enhancement doesn't bypass execution
    const { buildTermsWithSimulation } = require('../agents/negotiator');
    const enhancedTerms = await buildTermsWithSimulation(testLead, 25000, 20000, adapter, workspaceId, dealId);

    if (enhancedTerms && typeof enhancedTerms === 'object' && enhancedTerms.feasible !== undefined) {
      console.log('   ����� ���� ���� ���� ���� ���� � ��� �� �� �� �� �� ✓ Simulation-enhanced terms still go through execution path');
    } else {
      console.error('   ����� ���� ���� ���� ���� ���� ���� ��� �� �� �� �� �� �� Simulation-enhanced terms break execution path');
      allPassed = false;
    }
  } catch (error) {
    console.error(`   ����� ���� ���� ���� ���� ���� ���� ��� �� �� �� �� �� �� Error verifying execution path: ${error.message}`);
    allPassed = false;
  }

  console.log(`\n${allPassed ? '����������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������✓ Consequential action isolation tests PASSED' : '��������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������✗ Consequential action isolation tests FAILED'}`);

  return {
    CONSEQUENTIAL_ACTION_ISOLATION: allPassed ? 'PASS' : 'FAIL',
    details: allPassed ? 'Simulation outputs remain as analysis/recommendations only, cannot trigger execution' : 'Simulation outputs may contain or trigger execution actions'
  };
}

// Helper functions to detect execution commands in simulation outputs
function checkForExecutionCommands(output) {
  const executionPatterns = [
    /send\s+email/i,
    /create\s+payment/i,
    /process\s+transaction/i,
    /transfer\s+funds/i,
    /execute\s+trade/i,
    /approve\s+deal/i,
    /modify\s+entitlement/i,
    /bypass\s+sentinel/i,
    /disable\s+security/i,
    /override\s+authorization/i,
    /grant\s+access/i,
    /execute\s+command/i,
    /run\s+process/i,
    /invoke\s+api/i,
    /call\s+endpoint/i,
    /trigger\s+action/i,
    /initiate\s+transfer/i,
    /process\s+refund/i,
    /issue\s+invoice/i
  ];

  return executionPatterns.some(pattern => pattern.test(output));
}

function checkForPaymentActions(output) {
  const paymentPatterns = [
    /charge\s+card/i,
    /process\s+payment/i,
    /create\s+invoice/i,
    /bill\s+customer/i,
    /collect\s+money/i,
    /transfer\s+money/i,
    /wire\s+transfer/i,
    /ach\s+payment/i,
    /credit\s+card/i,
    /debit\s+card/i
  ];

  return paymentPatterns.some(pattern => pattern.test(output));
}

function checkForApprovalActions(output) {
  const approvalPatterns = [
    /approve\s+request/i,
    /grant\s+approval/i,
    /authorize\s+action/i,
    /sign\s+off/i,
    /give\s+consent/i,
    /provide\s+authorization/i,
    /allow\s+proceed/i,
    /clear\s+for\s+execution/i
  ];

  return approvalPatterns.some(pattern => pattern.test(output));
}

function checkForEntitlementActions(output) {
  const entitlementPatterns = [
    /grant\s+access/i,
    /provide\s+license/i,
    /allocate\s+resources/i,
    /assign\s+role/i,
    /modify\s+permissions/i,
    /change\s+entitlement/i,
    /update\s+subscription/i,
    /extend\s+trial/i
  ];

  return entitlementPatterns.some(pattern => pattern.test(output));
}

function checkForSecurityBypassActions(output) {
  const bypassPatterns = [
    /bypass\s+security/i,
    /disable\s+sentinel/i,
    /turn\s+off\s+protection/i,
    /ignore\s+policies/i,
    /override\s+controls/i,
    /circumvent\s+authorization/i,
    /skip\s+validation/i,
    /ignore\s+approval/i
  ];

  return bypassPatterns.some(pattern => pattern.test(output));
}

runConsequentialActionTests().then(result => {
  console.log(JSON.stringify(result, null, 2));
}).catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
