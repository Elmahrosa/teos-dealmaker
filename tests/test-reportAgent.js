const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const reportAgent = require('../services/reportAgent');
const dealSimulation = require('../services/dealSimulation');

async function runTests() {
  console.log('Testing Report Agent...\n');

  // Setup
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  // Create a test workspace and deal
  const workspaceResult = await adapter.insert('workspaces', { name: 'Test Workspace', slug: 'test', plan: 'solo' });
  const workspaceId = workspaceResult.id;
  const dealResult = await adapter.insert('deals', { id: 1, workspace_id: workspaceId, company_name: 'Test Corp', stage: 'negotiation', status: 'open' });
  const dealId = dealResult.id;

  // Test 1: Generate a report (will use simulated data since no real intelligence)
  console.log('Test 1: Generating deal strategy report...');
  try {
    // Since we don't have real data, this will use fallback mechanisms
    const report = await reportAgent.generateReport(adapter, workspaceId, dealId);
    console.log(`   PASS: Generated report`);
    console.log(`   Report ID: ${report.metadata.reportId}`);
    console.log(`   Executive summary length: ${report.executiveSummary.opportunity.length} chars`);
    console.log(`   Stakeholder count: ${report.stakeholderMap.stakeholders.length}`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 2: Test that report has all expected sections
  console.log('\nTest 2: Verifying report sections...');
  try {
    const report = await reportAgent.generateReport(adapter, workspaceId, dealId);
    const requiredSections = [
      'executiveSummary',
      'dealSituation',
      'stakeholderMap',
      'decisionStructure',
      'customerNeeds',
      'objections',
      'competitiveLandscape',
      'negotiationRisks',
      'scenarioComparison',
      'recommendedPosition',
      'nextSteps',
      'appendix'
    ];

    const missingSections = requiredSections.filter(section => !(section in report));
    if (missingSections.length === 0) {
      console.log(`   PASS: All ${requiredSections.length} sections present`);
    } else {
      console.error(`   FAIL: Missing sections: ${missingSections.join(', ')}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  console.log('\n��������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������✓ Report agent tests completed successfully');
  process.exit(0);
}

runTests().catch(err => {
  console.error('����������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������✗ Report agent test failed:', err);
  process.exit(1);
});