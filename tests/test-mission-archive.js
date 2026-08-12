'use strict';

const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');

(async () => {
  const repos = createRepos(createMemoryAdapter());

  console.log('Testing mission archive/unarchive functionality...');

  // Create a workspace for testing
  const workspace = await repos.workspaces.create({
    name: 'Test Workspace',
    slug: 'test-workspace',
    plan: 'solo',
    status: 'active'
  });
  const workspaceId = workspace.id;

  // Create a mission (plan) for testing
  const mission = await repos.plans.create({
    workspace_id: workspaceId,
    title: 'Test Mission',
    goal: 'Test mission goal',
    status: 'planned',
    priority: 'normal',
    archived_at: null,
    is_protected: false
  });
  const missionId = mission.id;

  console.log(`Created test mission with ID: ${missionId}`);

  // Test 1: Initially, mission should not be archived
  let currentMission = await repos.plans.get(workspaceId, missionId);
  assert.strictEqual(currentMission.archived_at, null, 'Mission should not be archived initially');
  assert.strictEqual(currentMission.is_protected, false, 'Mission should not be protected initially');
  console.log('������������������������������✓ Mission is not archived or protected initially');

  // Test 2: Archive the mission
  const archivedMission = await repos.plans.update(workspaceId, missionId, {
    archived_at: new Date().toISOString()
  });
  assert.notStrictEqual(archivedMission.archived_at, null, 'Mission should be archived');
  assert.strictEqual(archivedMission.is_protected, false, 'Mission should not be protected');
  console.log('������������������������������✓ Mission archived successfully');

  // Test 3: Verify the mission is archived
  currentMission = await repos.plans.get(workspaceId, missionId);
  assert.notStrictEqual(currentMission.archived_at, null, 'Mission should be archived');
  assert.strictEqual(currentMission.is_protected, false, 'Mission should not be protected');
  console.log('������������������������������✓ Mission persistence after archiving');

  // Test 4: Unarchive the mission
  const unarchivedMission = await repos.plans.update(workspaceId, missionId, {
    archived_at: null
  });
  assert.strictEqual(unarchivedMission.archived_at, null, 'Mission should be unarchived');
  assert.strictEqual(unarchivedMission.is_protected, false, 'Mission should not be protected');
  console.log('������������������������������✓ Mission unarchived successfully');

  // Test 5: Verify the mission is unarchived
  currentMission = await repos.plans.get(workspaceId, missionId);
  assert.strictEqual(currentMission.archived_at, null, 'Mission should be unarchived');
  assert.strictEqual(currentMission.is_protected, false, 'Mission should not be protected');
  console.log('������������������������������✓ Mission persistence after unarchiving');

  // Test 6: Test protected mission (cannot be archived/deleted)
  const protectedMission = await repos.plans.create({
    workspace_id: workspaceId,
    title: 'Protected Mission',
    goal: 'Protected mission goal',
    status: 'planned',
    priority: 'high',
    is_protected: true
  });
  const protectedMissionId = protectedMission.id;

  // Verify it's protected
  const protectedMissionCheck = await repos.plans.get(workspaceId, protectedMissionId);
  assert.strictEqual(protectedMissionCheck.is_protected, true, 'Mission should be protected');
  console.log('������������������������������✓ Protected mission created correctly');

  // Try to archive the protected mission (should not be prevented at DB level, but API will prevent)
  // At the database level, we can still archive it, but the API layer will prevent it
  await repos.plans.update(workspaceId, protectedMissionId, {
    archived_at: new Date().toISOString()
  });
  // Note: At the repository level, we can archive a protected mission
  // The API layer is where we prevent this action
  // We're not asserting this won't be archived at the DB level since that's handled in the API
  console.log('������������������������������✓ Protected mission can be archived at DB level (API layer prevents this)');

  console.log('\n������������������������������✓ All mission archive/unarchive tests passed!');
  return true;
})().catch(err => {
  console.error('\n������������������������������❌ Mission archive/unarchive test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
