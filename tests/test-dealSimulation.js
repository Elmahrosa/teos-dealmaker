const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const dealSimulation = require('../services/dealSimulation');

async function runTests() {
  console.log('Testing Deal Simulation Service...\n');

  // Setup
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  // Create a test workspace and deal
  const workspaceResult = await adapter.insert('workspaces', { name: 'Test Workspace', slug: 'test', plan: 'solo' });
  const workspaceId = workspaceResult.id;
  const dealResult = await adapter.insert('deals', { workspace_id: workspaceId, company_name: 'Test Corp', stage: 'negotiation', status: 'open' });
  const dealId = dealResult.id;

  // Declare variables outside try blocks so they're accessible to all tests
  let scenarioId;

  // Test 1: Build stakeholder intelligence with no existing data
  console.log('Test 1: Building stakeholder intelligence with minimal data...');
  try {
    const result = await dealSimulation.buildStakeholderIntelligence(adapter, workspaceId, dealId);
    console.log(`   PASS: Returned stakeholder intelligence with ${result.stakeholders.length} stakeholders`);
    console.log(`   Confidence: ${result.confidence}`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 2: Create a scenario
  console.log('\nTest 2: Creating a simulation scenario...');
  try {
    const scenarioResult = await repos.deal_scenarios.add({
      workspace_id: workspaceId,
      deal_id: dealId,
      name: 'Test Scenario',
      description: 'A test scenario for validation',
      scenario_type: 'stakeholder_analysis',
      parameters: { test: true }
    });
    scenarioId = scenarioResult.id;
    console.log(`   PASS: Created scenario with ID ${scenarioId}`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 3: Get the scenario
  console.log('\nTest 3: Retrieving the scenario...');
  try {
    const retrieved = await repos.deal_scenarios.get(workspaceId, scenarioId);
    console.log(`   PASS: Retrieved scenario: ${retrieved.name}`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 4: List scenarios for workspace and deal
  console.log('\nTest 4: Listing scenarios...');
  try {
    const list = await repos.deal_scenarios.list(workspaceId, dealId);
    console.log(`   PASS: Found ${list.length} scenarios`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 5: Create a simulation run
  console.log('\nTest 5: Creating a simulation run...');
  try {
    const run = await repos.simulation_runs.add({
      workspace_id: workspaceId,
      deal_scenario_id: scenarioId,
      status: 'completed',
      results: { outcome: 'test' },
      duration_ms: 100,
      cost_cents: 10
    });
    console.log(`   PASS: Created simulation run with ID ${run.id}`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 6: Test cross-workspace isolation (should not see other workspace's data)
  console.log('\nTest 6: Testing cross-workspace isolation...');
  try {
    // Create another workspace
    const workspace2Result = await adapter.insert('workspaces', { name: 'Test Workspace 2', slug: 'test2', plan: 'solo' });
    const workspaceId2 = workspace2Result.id;
    const deal2Result = await adapter.insert('deals', { workspace_id: workspaceId2, company_name: 'Test Corp 2', stage: 'negotiation', status: 'open' });
    const dealId2 = deal2Result.id;

    // Create scenario in workspace 2
    await repos.deal_scenarios.add({
      workspace_id: workspaceId2,
      deal_id: dealId2,
      name: 'Workspace 2 Scenario',
      description: 'Should not be visible from workspace 1',
      scenario_type: 'financial_model',
      parameters: { test: true }
    });

    // Try to list scenarios for workspace 1, deal 1 - should not see workspace 2's scenario
    const list = await repos.deal_scenarios.list(workspaceId, dealId);
    if (list.length === 1 && list[0].name === 'Test Scenario') {
      console.log('   PASS: Correctly isolated - only sees own workspace\'s scenario');
    } else {
      console.error(`   FAIL: Isolation broken - sees ${list.length} scenarios`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  console.log('\n������������������������������������������������������������������������������������������������������������������������������✓ Deal simulation tests completed successfully');
  process.exit(0);
}

runTests().catch(err => {
  console.error('������������������������������������������������������������������������������������������������������������������������������✗ Deal simulation test failed:', err);
  process.exit(1);
});

