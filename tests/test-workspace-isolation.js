'use strict';

const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');

(async () => {
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  console.log('Testing workspace isolation in Command Center...');

  // Create two workspaces for testing
  const workspaceA = await repos.workspaces.create({
    name: 'Workspace A',
    slug: 'workspace-a',
    plan: 'solo',
    status: 'active'
  });
  const workspaceIdA = workspaceA.id;

  const workspaceB = await repos.workspaces.create({
    name: 'Workspace B',
    slug: 'workspace-b',
    plan: 'growth',
    status: 'active'
  });
  const workspaceIdB = workspaceB.id;

  // Create missions in workspace A
  const missionA1 = await repos.plans.create({
    workspace_id: workspaceIdA,
    title: 'Mission A1',
    goal: 'Goal for mission A1',
    status: 'completed',
    priority: 'high'
  });

  const missionA2 = await repos.plans.create({
    workspace_id: workspaceIdA,
    title: 'Mission A2',
    goal: 'Goal for mission A2',
    status: 'planned',
    priority: 'normal'
  });

  // Create missions in workspace B
  const missionB1 = await repos.plans.create({
    workspace_id: workspaceIdB,
    title: 'Mission B1',
    goal: 'Goal for mission B1',
    status: 'completed',
    priority: 'normal'
  });

  const missionB2 = await repos.plans.create({
    workspace_id: workspaceIdB,
    title: 'Mission B2',
    goal: 'Goal for mission B2',
    status: 'failed',
    priority: 'low'
  });

  console.log(`Created test missions:
    - Workspace A: ${missionA1.id}, ${missionA2.id}
    - Workspace B: ${missionB1.id}, ${missionB2.id}`);

  // Test 1: Get all missions (no workspace filter) - should return all 4 missions
  let allMissions = await repos.plans.list();
  // Filter to just our test missions (in case there are others from other tests)
  const ourMissions = allMissions.filter(m =>
    [missionA1.id, missionA2.id, missionB1.id, missionB2.id].includes(m.id)
  );
  assert.strictEqual(ourMissions.length, 4, 'Should be able to see all missions when no workspace filter is applied');
  console.log('��������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������✓ Can see all missions when no workspace filter is applied');

  // Test 2: Get missions for workspace A only - should return 2 missions
  const missionsFromWorkspaceA = await repos.plans.list(workspaceIdA);
  const workspaceAMissions = missionsFromWorkspaceA.filter(m =>
    [missionA1.id, missionA2.id].includes(m.id)
  );
  assert.strictEqual(workspaceAMissions.length, 2, 'Should see only missions from workspace A when filtered by workspace A ID');
  console.log('��������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������✓ Can see only workspace A missions when filtered by workspace A ID');

  // Test 3: Get missions for workspace B only - should return 2 missions
  const missionsFromWorkspaceB = await repos.plans.list(workspaceIdB);
  const workspaceBMissions = missionsFromWorkspaceB.filter(m =>
    [missionB1.id, missionB2.id].includes(m.id)
  );
  assert.strictEqual(workspaceBMissions.length, 2, 'Should see only missions from workspace B when filtered by workspace B ID');
  console.log('��������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������✓ Can see only workspace B missions when filtered by workspace B ID');

  // Test 4: Verify workspace filtering excludes missions from other workspace
  // Workspace A filter should not include workspace B missions
  const workspaceAExcludesBMissions = missionsFromWorkspaceA.every(m =>
    ![missionB1.id, missionB2.id].includes(m.id)
  );
  assert.strictEqual(workspaceAExcludesBMissions, true, 'Workspace A filter should exclude workspace B missions');

  // Workspace B filter should not include workspace A missions
  const workspaceBExcludesAMissions = missionsFromWorkspaceB.every(m =>
    ![missionA1.id, missionA2.id].includes(m.id)
  );
  assert.strictEqual(workspaceBExcludesAMissions, true, 'Workspace B filter should exclude workspace A missions');
  console.log('��������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������✓ Workspace filtering properly excludes missions from other workspaces');

  // Test 5: Test with status filtering combined with workspace filtering
  // Get completed missions from workspace A
  const completedMissionsAnot = await repos.plans.list(workspaceIdA);
  const completedInA = completedMissionsAnot.filter(m => m.status === 'completed');
  assert.strictEqual(completedInA.length, 1, 'Should see 1 completed mission in workspace A');
  assert.strictEqual(completedInA[0].id, missionA1.id, 'The completed mission in workspace A should be mission A1');

  // Get completed missions from workspace B
  const completedMissionsBnot = await repos.plans.list(workspaceIdB);
  const completedInB = completedMissionsBnot.filter(m => m.status === 'completed');
  assert.strictEqual(completedInB.length, 1, 'Should see 1 completed mission in workspace B');
  assert.strictEqual(completedInB[0].id, missionB1.id, 'The completed mission in workspace B should be mission B1');
  console.log('��������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������✓ Workspace filtering works correctly with status filtering');

  console.log('\n��������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������✓ All workspace isolation tests passed!');
  return true;
})().catch(err => {
  console.error('\n��������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������❌ Workspace isolation test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
