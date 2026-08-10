const { createAdapter } = require('./db');
const { createRepos } = require('./db/repos');

let adapter;
if (process.env.DATABASE_URL) {
  adapter = require('./db').getAdapter();
} else {
  adapter = require('./db').createMemoryAdapter();
}

async function main() {
  try {
    const repos = createRepos(adapter);
    const workspaceId = 1;

    console.log('=== All approval requests for workspace ===');
    const allApprovals = await repos.approvals.list(workspaceId, null); // status null means all
    console.log(`Total approvals: ${allApprovals.length}`);
    for (const a of allApprovals) {
      console.log(`ID: ${a.id}, plan_id: ${a.plan_id}, step_id: ${a.step_id}, agent_type: ${a.agent_type}, status: ${a.status}, reason: ${a.reason}`);
    }

    console.log('\n=== Plan steps for plan 5 ===');
    const steps = await repos.planSteps.list(5);
    for (const s of steps) {
      console.log(`ID: ${s.id}, step_key: ${s.step_key}, agent_type: ${s.agent_type}, status: ${s.status}`);
    }

    console.log('\n=== Plan 5 ===');
    const plan = await repos.plans.get(5);
    console.log(plan);

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();