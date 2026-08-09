const { createMemoryAdapter } = require('../db/adapter');
const negotiationRehearsalService = require('../services/negotiationRehearsal');

async function runTests() {
  console.log('Testing Negotiation Rehearsal Service...\n');

  // Setup
  const adapter = createMemoryAdapter();

  // Create a test workspace and deal
  const workspaceResult = await adapter.insert('workspaces', { name: 'Test Workspace', slug: 'test', plan: 'solo' });
  const workspaceId = workspaceResult.id;
  const dealResult = await adapter.insert('deals', { id: 1, workspace_id: workspaceId, company_name: 'Test Corp', stage: 'negotiation', status: 'open' });
  const dealId = dealResult.id;

  // Test 1: Start a rehearsal session
  console.log('Test 1: Starting negotiation rehearsal session...');
  try {
    const session = await negotiationRehearsalService.startRehearsal(adapter, workspaceId, dealId, 'user_1');
    console.log(`   PASS: Started session ${session.sessionId}`);
    console.log(`   Stakeholder: ${session.stakeholder.role}`);
    console.log(`   Message length: ${session.message.length} chars`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 2: Process a response in the rehearsal
  console.log('\nTest 2: Processing user response...');
  try {
    // We need to start a session first to get a sessionId
    const session = await negotiationRehearsalService.startRehearsal(adapter, workspaceId, dealId, 'user_1');
    const response = await negotiationRehearsalService.processResponse(adapter, workspaceId, session.sessionId, 'I understand your concerns about pricing.');
    console.log('   PASS: Processed response');
    console.log(`   Stakeholder: ${response.stakeholder.role}`);
    console.log(`   Reaction type: ${response.reaction.type}`);
    console.log(`   Feedback score: ${response.feedback.score}`);
    console.log(`   Is complete: ${response.isComplete}`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 3: End a rehearsal and get summary
  console.log('\nTest 3: Ending rehearsal session...');
  try {
    const session = await negotiationRehearsalService.startRehearsal(adapter, workspaceId, dealId, 'user_1');
    // Process one response to have some history
    await negotiationRehearsalService.processResponse(adapter, workspaceId, session.sessionId, 'Test response');
    const summary = negotiationRehearsalService.endRehearsal(session.sessionId);
    console.log('   PASS: Ended session');
    console.log(`   Duration: ${summary.durationMs}ms`);
    console.log(`   Total exchanges: ${summary.summary.totalExchanges}`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  // Test 4: Verify styles and difficulties are available
  console.log('\nTest 4: Checking available styles and difficulties...');
  try {
    // Access static methods from the class
    const NegotiationRehearsalClass = negotiationRehearsalService.constructor;
    const styles = NegotiationRehearsalClass.getAvailableStyles();
    const difficulties = NegotiationRehearsalClass.getAvailableDifficulties();
    console.log(`   PASS: Found ${styles.length} styles: ${styles.join(', ')}`);
    console.log(`   PASS: Found ${difficulties.length} difficulties: ${difficulties.join(', ')}`);
  } catch (error) {
    console.error(`   FAIL: ${error.message}`);
    process.exit(1);
  }

  console.log('\n����������������������������������������������������✓ Negotiation rehearsal tests completed successfully');
  process.exit(0);
}

runTests().catch(err => {
  console.error('����������������������������������������������������✗ Negotiation rehearsal test failed:', err);
  process.exit(1);
});
