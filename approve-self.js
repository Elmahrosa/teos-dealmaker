const { createAdapter } = require('./db');
const { createRepos } = require('./db/repos');
const runtime = require('./services/workforce/runtime');

let adapter;
if (process.env.DATABASE_URL) {
  adapter = require('./db').getAdapter();
} else {
  adapter = require('./db').createMemoryAdapter();
}

async function main() {
  try {
    console.log('Initializing database adapter...');
    const repos = createRepos(adapter);

    const workspaceId = 1; // from previous script
    const founderUserId = 2; // from previous script

    console.log(`Fetching pending approvals for workspace ${workspaceId}...`);
    const pending = await repos.approvals.list(workspaceId, 'pending');
    console.log(`Found ${pending.length} pending approval requests.`);

    if (pending.length === 0) {
      console.log('No pending approvals. Nothing to do.');
      return 0;
    }

    // We expect one approval for the gatekeeper present step of plan 5
    for (const req of pending) {
      console.log(`Approval request ${req.id}: agent_type=${req.agent_type}, step_id=${req.step_id}, plan_id=${req.plan_id}, reason: ${req.reason}`);
      // Check if this is for our plan (planId 5) and agent_type gatekeeper
      if (req.plan_id === 5 && req.agent_type === 'gatekeeper') {
        console.log(`Approving request ${req.id} as founder user ${founderUserId}...`);
        const decision = await repos.approvals.update(req.id, { status: 'approved' });
        // Also need to update the plan step? The runtime's approveAndResume handles that.
        // Let's use the runtime's approveAndResume function.
        const { decision: dec, resumed, ...outcome } = await runtime.approveAndResume(adapter, workspaceId, req.id, founderUserId);
        console.log(`Approval decision: ${decision.status}`);
        console.log(`Resumed: ${resumed}`);
        if (resumed) {
          console.log(`Mission resumed. Outcome status: ${outcome.status}`);
          console.log(`Briefing:\n${outcome.briefing}`);
        } else {
          console.log('Failed to resume mission.');
          console.log(outcome);
        }
        break;
      }
    }

    return 0;
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();