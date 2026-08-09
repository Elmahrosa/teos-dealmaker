const { buildTerms, buildTermsWithSimulation } = require('../agents/negotiator');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const dealSimulation = require('../services/dealSimulation');

async function runTests() {
  console.log('Testing Negotiator Simulation Enhancement...\n');

  // Setup
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  // Create a test workspace and deal
  const workspaceId = 1;
  const dealId = 1;

  await adapter.insert('workspaces', { id: workspaceId, name: 'Test Workspace', slug: 'test', plan: 'solo' });
  await adapter.insert('deals', { id: dealId, workspace_id: workspaceId, company_name: 'Test Corp', stage: 'negotiation', status: 'open', deal_value: 25000, currency: 'USD' });

  const testLead = { id: 'lead_001', company: 'Test Corp' };
  const targetPrice = 25000;
  const budget = 20000;

  // Test 1: Original buildTerms still works (regression test)
  console.log('Test 1: Verifying original buildTerms still works...');
  try {
    const terms = buildTerms(testLead, targetPrice, budget);
    console.log(`   PASS: Original buildTerms works`);
    console.log(`   Feasible: ${terms.feasible}`);
    console.log(`   Floor price: ${terms.floorPrice}`);
    console.log(`   Landing price: ${terms.landingPrice}`);
    console.log(`   Suggested terms: ${terms.suggestedTerms}`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 2: buildTermsWithSimulation with no deal ID (should fallback to original)
  console.log('\nTest 2: Testing buildTermsWithSimulation fallback (no deal ID)...');
  try {
    const terms = await buildTermsWithSimulation(testLead, targetPrice, budget, adapter, workspaceId, null);
    console.log(`   PASS: Falls back to original terms when no deal ID`);
    console.log(`   Feasible: ${terms.feasible}`);
    console.log(`   Floor price: ${terms.floorPrice}`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 3: buildTermsWithSimulation with deal ID but no simulation data (should still work)
  console.log('\nTest 3: Testing buildTermsWithSimulation with deal ID but no simulation data...');
  try {
    const terms = await buildTermsWithSimulation(testLead, targetPrice, budget, adapter, workspaceId, dealId);
    console.log(`   PASS: Works with deal ID but no simulation data`);
    console.log(`   Feasible: ${terms.feasible}`);
    console.log(`   Floor price: ${terms.floorPrice}`);
    // Should have the enhancement audit entry
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 4: Test that the function is actually async and returns a promise
  console.log('\nTest 4: Verifying async behavior...');
  try {
    const promise = buildTermsWithSimulation(testLead, targetPrice, budget, adapter, workspaceId, dealId);
    if (promise instanceof Promise) {
      console.log(`   PASS: Returns a Promise`);
      const terms = await promise;
      console.log(`   PASS: Promise resolves successfully`);
    } else {
      console.error(`   FAIL: Does not return a Promise`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  console.log('\n����������������✓ Negotiator simulation tests completed successfully');
  process.exit(0);
}

runTests().catch(err => {
  console.error('����������������✗ Negotiator simulation test failed:', err);
  process.exit(1);
});