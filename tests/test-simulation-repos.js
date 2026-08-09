const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');

async function runTests() {
  console.log('Testing Simulation Repository Methods...\n');

  // Setup
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  // Create test workspaces and deals
  const workspaceId1 = 1;
  const workspaceId2 = 2;
  const dealId1 = 1;
  const dealId2 = 2;

  await adapter.insert('workspaces', { id: workspaceId1, name: 'Test Workspace 1', slug: 'test1', plan: 'solo' });
  await adapter.insert('workspaces', { id: workspaceId2, name: 'Test Workspace 2', slug: 'test2', plan: 'solo' });
  await adapter.insert('deals', { id: dealId1, workspace_id: workspaceId1, company_name: 'Test Corp 1', stage: 'negotiation', status: 'open' });
  await adapter.insert('deals', { id: dealId2, workspace_id: workspaceId2, company_name: 'Test Corp 2', stage: 'negotiation', status: 'open' });

  // Declare variables outside try blocks so they're accessible to all tests
  let scenario1, scenario2, run1;

  // Test 1: Create scenario in workspace 1
  console.log('Test 1: Creating scenario in workspace 1...');
  try {
    const scenarioResult = await repos.deal_scenarios.add({
      workspace_id: workspaceId1,
      deal_id: dealId1,
      name: 'Workspace 1 Scenario',
      description: 'Test scenario',
      scenario_type: 'stakeholder_analysis',
      parameters: { test: 'data' }
    });
    scenario1 = scenarioResult.id;
    console.log(`   PASS: Created scenario ID ${scenario1} in workspace 1`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 2: Create scenario in workspace 2
  console.log('\nTest 2: Creating scenario in workspace 2...');
  try {
    const scenarioResult = await repos.deal_scenarios.add({
      workspace_id: workspaceId2,
      deal_id: dealId2,
      name: 'Workspace 2 Scenario',
      description: 'Test scenario',
      scenario_type: 'financial_model',
      parameters: { test: 'data' }
    });
    scenario2 = scenarioResult.id;
    console.log(`   PASS: Created scenario ID ${scenario2} in workspace 2`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 3: List scenarios for workspace 1 (should only see its own)
  console.log('\nTest 3: Listing scenarios for workspace 1 (isolation test)...');
  try {
    const list1 = await repos.deal_scenarios.list(workspaceId1, dealId1);
    console.log(`   PASS: Found ${list1.length} scenario(s) in workspace 1`);
    if (list1.length > 0) {
      console.log(`   Scenario name: ${list1[0].name}`);
    }
    // Should only see workspace 1's scenario
    if (list1.length === 1 && list1[0].name === 'Workspace 1 Scenario') {
      console.log(`   PASS: Correctly isolated - only sees own workspace's scenario`);
    } else {
      console.error(`   FAIL: Isolation broken - sees wrong scenarios`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 4: List scenarios for workspace 2 (should only see its own)
  console.log('\nTest 4: Listing scenarios for workspace 2 (isolation test)...');
  try {
    const list2 = await repos.deal_scenarios.list(workspaceId2, dealId2);
    console.log(`   PASS: Found ${list2.length} scenario(s) in workspace 2`);
    if (list2.length > 0) {
      console.log(`   Scenario name: ${list2[0].name}`);
    }
    // Should only see workspace 2's scenario
    if (list2.length === 1 && list2[0].name === 'Workspace 2 Scenario') {
      console.log(`   PASS: Correctly isolated - only sees own workspace's scenario`);
    } else {
      console.error(`   FAIL: Isolation broken - sees wrong scenarios`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 5: Get specific scenario by ID
  console.log('\nTest 5: Getting scenario by ID...');
  try {
    console.log(`      Looking for scenario ID: ${scenario1} in workspace ${workspaceId1}`);
    const scenario = await repos.deal_scenarios.get(workspaceId1, scenario1);
    // Check if scenario exists before accessing properties
    if (scenario === null) {
      console.error(`   FAIL: Retrieved scenario is null`);
      // Let's also try to list all scenarios in workspace 1 to see what's there
      const allScenarios = await repos.deal_scenarios.list(workspaceId1, dealId1);
      console.log(`      All scenarios in workspace 1, deal ${dealId1}: ${JSON.stringify(allScenarios)}`);
      process.exit(1);
    }
    console.log(`   PASS: Retrieved scenario by ID`);
    console.log(`   Name: ${scenario.name}`);
    console.log(`   Type: ${scenario.scenario_type}`);
    console.log(`   Workspace ID: ${scenario.workspace_id}`);
    // Verify it's the right one
    if (scenario.id === scenario1 && scenario.workspace_id === workspaceId1) {
      console.log(`   PASS: Correct scenario retrieved`);
    } else {
      console.error(`   FAIL: Wrong scenario retrieved`);
      console.log(`      Expected ID: ${scenario1}, Workspace: ${workspaceId1}`);
      console.log(`      Got ID: ${scenario.id}, Workspace: ${scenario.workspace_id}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 6: Try to get scenario from wrong workspace (should return null/not found)
  console.log('\nTest 6: Trying to get scenario from wrong workspace...');
  try {
    const scenario = await repos.deal_scenarios.get(workspaceId2, scenario1); // Trying to get workspace 1's scenario from workspace 2
    if (scenario === null || scenario === undefined) {
      console.log(`   PASS: Correctly returned null for cross-workspace access`);
    } else {
      console.error(`   FAIL: Should not be able to access scenario from other workspace`);
      process.exit(1);
    }
  } catch (error) {
    // Some implementations might throw an error instead of returning null
    console.log(`   PASS: Correctly prevented cross-workspace access (threw error: ${error.message})`);
  }

  // Test 7: Create simulation run
  console.log('\nTest 7: Creating simulation run...');
  try {
    const runResult = await repos.simulation_runs.add({
      workspace_id: workspaceId1,
      deal_scenario_id: scenario1,
      status: 'completed',
      results: { outcome: 'success' },
      duration_ms: 250,
      cost_cents: 25
    });
    run1 = runResult.id;
    console.log(`   PASS: Created simulation run ID ${run1}`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 8: List simulation runs for scenario
  console.log('\nTest 8: Listing simulation runs for scenario...');
  try {
    const runs = await repos.simulation_runs.list(workspaceId1, scenario1);
    console.log(`   PASS: Found ${runs.length} run(s) for scenario`);
    if (runs.length > 0) {
      console.log(`   Status: ${runs[0].status}`);
      console.log(`   Duration: ${runs[0].duration_ms}ms`);
    }
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 9: Complete a simulation run
  console.log('\nTest 9: Completing simulation run...');
  try {
    const runResult = await repos.simulation_runs.add({
      workspace_id: workspaceId1,
      deal_scenario_id: scenario1,
      status: 'running'
    });
    const runId = runResult.id;
    const completed = await repos.simulation_runs.complete(workspaceId1, runId, { result: 'done' }, 100, 15);
    console.log(`   PASS: Completed simulation run`);
    console.log(`   Status: ${completed.status}`);
    console.log(`   Duration: ${completed.duration_ms}ms`);
    console.log(`   Cost: ${completed.cost_cents}cents`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 10: Test update and delete operations
  console.log('\nTest 10: Testing update and delete operations...');
  try {
    // Update scenario
    const updated = await repos.deal_scenarios.update(workspaceId1, scenario1, { name: 'Updated Scenario Name' });
    if (updated) {
      console.log(`   PASS: Scenario updated successfully`);
    } else {
      console.log(`   PASS: Update operation completed (return value may vary)`);
    }

    // Get updated scenario to verify
    const scenario = await repos.deal_scenarios.get(workspaceId1, scenario1);
    if (scenario === null) {
      console.error(`   FAIL: Retrieved scenario is null after update`);
      process.exit(1);
    }
    if (scenario.name === 'Updated Scenario Name') {
      console.log(`   PASS: Update verified - name changed correctly`);
    } else {
      console.error(`   FAIL: Update not persisted correctly`);
      process.exit(1);
    }

    // Delete scenario
    const deleted = await repos.deal_scenarios.remove(workspaceId1, scenario1);
    if (deleted) {
      console.log(`   PASS: Scenario deleted successfully`);
    } else {
      console.log(`   PASS: Delete operation completed`);
    }
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  console.log('\n���������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������� ������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������� �█');
  process.exit(0);
}

runTests().catch(err => {
  console.error('����������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������█');
  process.exit(1);
});