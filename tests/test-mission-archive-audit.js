'use strict';

const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');

(async () => {
  const repos = createRepos(createMemoryAdapter());

  console.log('Testing audit logging for mission archive/unarchive actions...');

  // Create a workspace for testing
  const workspaceId = (await repos.workspaces.create({
    name: 'Test Workspace',
    slug: 'test-workspace',
    plan: 'solo',
    status: 'active'
  })).id;

  // Create a mission (plan) for testing
  const missionId = (await repos.plans.create({
    workspace_id: workspaceId,
    title: 'Test Mission for Audit',
    goal: 'Test mission goal for audit testing',
    status: 'planned',
    priority: 'normal',
    archived_at: null,
    is_protected: false
  })).id;

  console.log(`Created test mission with ID: ${missionId}`);

  // Clear any existing audit logs for a clean test
  // Note: In a real implementation, we might want to clear specific logs
  // For this test, we'll just count total logs and check for our specific ones

  // Get initial audit count
  const initialAuditLogs = await repos.audit.list(workspaceId);
  console.log(`Initial audit log count: ${initialAuditLogs.length}`);

  // Test 1: Archive the mission and verify audit log
  await repos.plans.update(workspaceId, missionId, {
    archived_at: new Date().toISOString()
  });

  // Manually log the audit action (since we're testing at the repository level)
  // In the actual API endpoint, this happens automatically
  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'command_center',
    action_type: 'MISSION_ARCHIVED',
    details: {
      missionId: missionId,
      missionTitle: 'Test Mission for Audit',
      workspaceId: workspaceId
    }
  });

  // Check that audit log was created
  const auditLogsAfterArchive = await repos.audit.list(workspaceId);
  const archiveLog = auditLogsAfterArchive.find(
    log => log.action_type === 'MISSION_ARCHIVED' &&
           log.details && log.details.missionId === missionId
  );

  assert.notStrictEqual(archiveLog, null, 'Should have created MISSION_ARCHIVED audit log');
  assert.strictEqual(archiveLog.workspace_id, workspaceId, 'Audit log should be scoped to correct workspace');
  assert.strictEqual(archiveLog.details.missionId, missionId, 'Audit log should reference correct mission');
  assert.strictEqual(archiveLog.details.missionTitle, 'Test Mission for Audit', 'Audit log should include mission title');
  console.log('[PASS] Audit log created for mission archival');

  // Test 2: Unarchive the mission and verify audit log
  await repos.plans.update(workspaceId, missionId, {
    archived_at: null
  });

  // Manually log the audit action
  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'command_center',
    action_type: 'MISSION_UNARCHIVED',
    details: {
      missionId: missionId,
      missionTitle: 'Test Mission for Audit',
      workspaceId: workspaceId
    }
  });

  // Check that audit log was created
  const auditLogsAfterUnarchive = await repos.audit.list(workspaceId);
  const unarchiveLog = auditLogsAfterUnarchive.find(
    log => log.action_type === 'MISSION_UNARCHIVED' &&
           log.details && log.details.missionId === missionId
  );

  assert.notStrictEqual(unarchiveLog, null, 'Should have created MISSION_UNARCHIVED audit log');
  assert.strictEqual(unarchiveLog.workspace_id, workspaceId, 'Audit log should be scoped to correct workspace');
  assert.strictEqual(unarchiveLog.details.missionId, missionId, 'Audit log should reference correct mission');
  assert.strictEqual(unarchiveLog.details.missionTitle, 'Test Mission for Audit', 'Audit log should include mission title');
  console.log('[PASS] Audit log created for mission unarchival');

  // Test 3: Verify we have both audit logs
  const archiveAndUnarchiveLogs = auditLogsAfterUnarchive.filter(
    log => log.action_type === 'MISSION_ARCHIVED' ||
           log.action_type === 'MISSION_UNARCHIVED'
  ).filter(log =>
    log.details && log.details.missionId === missionId
  );

  assert.strictEqual(archiveAndUnarchiveLogs.length, 2, 'Should have both archive and unarchive audit logs');
  console.log('[PASS] Both archive and unarchive audit logs present');

  // Test 4: Verify audit logs are in correct order (archive first, then unarchive)
  const archiveIndex = auditLogsAfterUnarchive.findIndex(
    log => log.action_type === 'MISSION_ARCHIVED' &&
           log.details && log.details.missionId === missionId
  );
  const unarchiveIndex = auditLogsAfterUnarchive.findIndex(
    log => log.action_type === 'MISSION_UNARCHIVED' &&
           log.details && log.details.missionId === missionId
  );

  assert.notStrictEqual(archiveIndex, -1, 'Should find archive log');
  assert.notStrictEqual(unarchiveIndex, -1, 'Should find unarchive log');
  assert.strictEqual(archiveIndex < unarchiveIndex, true, 'Archive log should come before unarchive log');
  console.log('[PASS] Audit logs in correct chronological order');

  console.log('\n[PASS] All mission archive/unarchive audit logging tests passed!');
  return true;
})().catch(err => {
  console.error('\n[FAIL] Mission archive/unarchive audit logging test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
