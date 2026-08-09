const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const interviewService = require('../services/interviewService');

async function runTests() {
  console.log('Testing Interview Service...\n');

  // Setup
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  // Create a test workspace and deal
  const workspaceResult = await adapter.insert('workspaces', { name: 'Test Workspace', slug: 'test', plan: 'solo' });
  const workspaceId = workspaceResult.id;
  const dealResult = await adapter.insert('deals', { id: 1, workspace_id: workspaceId, company_name: 'Test Corp', stage: 'negotiation', status: 'open' });
  const dealId = dealResult.id;

  // Test 1: Start an interview session
  console.log('Test 1: Starting interview session...');
  try {
    const session = await interviewService.startInterview(adapter, workspaceId, dealId, 'user_1');
    console.log(`   PASS: Started session ${session.sessionId}`);
    console.log(`   Stakeholder: ${session.stakeholder.role}`);
    console.log(`   Question: ${session.question.substring(0, 50)}...`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 2: Submit a response and get next question
  console.log('\nTest 2: Submitting interview response...');
  try {
    const session = await interviewService.startInterview(adapter, workspaceId, dealId, 'user_1');
    const result = await interviewService.submitResponse(adapter, workspaceId, session.sessionId, 'This is my response to the question');
    console.log(`   PASS: Submitted response`);
    console.log(`   Is complete: ${result.isComplete}`);
    console.log(`   Progress: ${result.progress.question}/${result.progress.totalQuestions}`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 3: End an interview and get partial results
  console.log('\nTest 3: Ending interview session...');
  try {
    const session = await interviewService.startInterview(adapter, workspaceId, dealId, 'user_1');
    // Submit one response
    await interviewService.submitResponse(adapter, workspaceId, session.sessionId, 'Test response');
    const partial = interviewService.endInterview(session.sessionId);
    console.log(`   PASS: Ended interview`);
    console.log(`   Questions completed: ${partial.progress.questionsCompleted}/${partial.progress.totalQuestions}`);
    console.log(`   Stakeholders completed: ${partial.progress.stakeholdersCompleted}/${partial.progress.totalStakeholders}`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 4: Verify interview types are available
  console.log('\nTest 4: Checking available interview types...');
  try {
    // Get the class from the instance's constructor
    const InterviewServiceClass = interviewService.constructor;
    const types = InterviewServiceClass.getAvailableTypes();
    console.log(`   PASS: Found ${types.length} types: ${types.join(', ')}`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  console.log('\n������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������✓ Interview service tests completed successfully');
  process.exit(0);
}

runTests().catch(err => {
  console.error('������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������✗ Interview service test failed:', err);
  process.exit(1);
});