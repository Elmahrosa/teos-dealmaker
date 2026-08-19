'use strict';

const { getAdapter } = require('./db/index');
const { createRepos } = require('./db/repos');
const { createMembershipService } = require('./services/aiRoom/membershipService');
const audit = require('./utils/auditLogger');

async function testMembershipAudit() {
  console.log('Testing membership service audit logging...');

  const adapter = getAdapter();
  const repos = createRepos(adapter);

  const membershipService = createMembershipService({ repos });

  // Create workspace
  const workspaceA = await repos.workspaces.create({
    name: 'Workspace A',
    slug: 'workspace-a',
    plan: 'solo',
    status: 'active'
  });
  const workspaceIdA = workspaceA.id;

  // Create users
  const userA1 = await repos.users.create({
    email: 'userA1@test.com',
    display_name: 'User A1'
  });

  // Create room
  const roomA = await repos.rooms.create({
    workspace_id: workspaceIdA,
    name: 'Room A',
    purpose: 'Test room A'
  });
  const roomIdA = roomA.id;

  // Check initial audit count
  const initialAudit = await repos.audit.list(workspaceIdA);
  console.log(`Initial audit entries: ${initialAudit.length}`);

  // Test the audit logger directly first
  console.log('\n--- Testing audit logger directly ---');
  try {
    const directEntry = await audit.writeEntry('DIRECT_TEST', 'test_target', 'success', { test: 'data' });
    console.log('Direct audit entry written:', directEntry);

    const afterDirectAudit = await repos.audit.list(workspaceIdA);
    console.log(`Audit entries after direct write: ${afterDirectAudit.length}`);

    if (afterDirectAudit.length > 0) {
      console.log('Direct audit entry:');
      console.log(`  - ${afterDirectAudit[0].action_type}: ${JSON.stringify(afterDirectAudit[0].details)}`);
    }
  } catch (err) {
    console.error('Error writing direct audit entry:', err);
  }

  // Add membership through service
  console.log('\n--- Testing membership service ---');
  const addResult = await membershipService.add({
    room_id: roomIdA,
    user_id: userA1.id,
    role: 'MEMBER' // Use uppercase to match validRoles
  });
  console.log('Add result:', addResult);

  // Check audit count after addition
  const afterAudit = await repos.audit.list(workspaceIdA);
  console.log(`Audit entries after membership add: ${afterAudit.length}`);

  // Show the audit entries
  console.log('\nAudit entries:');
  for (const entry of afterAudit) {
    console.log(`  - ${entry.action_type}: ${JSON.stringify(entry.details)}`);
  }

  // Test removal
  const removeResult = await membershipService.remove(roomIdA, userA1.id);
  console.log('Remove result:', removeResult);

  // Check audit count after removal
  const afterRemoveAudit = await repos.audit.list(workspaceIdA);
  console.log(`Audit entries after membership remove: ${afterRemoveAudit.length}`);

  console.log('\nAudit entries after removal:');
  for (const entry of afterRemoveAudit) {
    console.log(`  - ${entry.action_type}: ${JSON.stringify(entry.details)}`);
  }

  const success = afterAudit.length > initialAudit.length &&
                  afterRemoveAudit.length > afterAudit.length;
  console.log(`\nTest ${success ? 'PASSED' : 'FAILED'}: Membership service audit logging is working correctly`);

  return success;
}

testMembershipAudit().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
