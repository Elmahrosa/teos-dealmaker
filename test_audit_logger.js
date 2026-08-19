'use strict';

const { createMemoryAdapter } = require('./db/adapter');
const { createRepos } = require('./db/repos');
const audit = require('./utils/auditLogger');

async function testAuditLogger() {
  console.log('Testing audit logger directly...');

  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  // Create workspace
  const workspaceA = await repos.workspaces.create({
    name: 'Workspace A',
    slug: 'workspace-a',
    plan: 'solo',
    status: 'active'
  });
  const workspaceIdA = workspaceA.id;

  // Check initial audit count
  const initialAudit = await repos.audit.list(workspaceIdA);
  console.log(`Initial audit entries: ${initialAudit.length}`);

  // Test writing an audit entry directly
  try {
    const entry = await audit.writeEntry('TEST_ACTION', 'test_target', 'success', { test: 'data' });
    console.log('Audit entry written:', entry);
  } catch (err) {
    console.error('Error writing audit entry:', err);
  }

  // Check audit count after writing
  const afterAudit = await repos.audit.list(workspaceIdA);
  console.log(`Audit entries after writing: ${afterAudit.length}`);

  // Show the audit entries
  console.log('\nAudit entries:');
  for (const entry of afterAudit) {
    console.log(`  - ${entry.action_type}: ${JSON.stringify(entry.details)}`);
  }
}

testAuditLogger().catch(console.error);
