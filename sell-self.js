const { getAdapter, createMemoryAdapter } = require('./db');
const { createRepos } = require('./db/repos');
const runtime = require('./services/workforce/runtime');

// Use memory adapter if no DATABASE_URL
let adapter;
if (process.env.DATABASE_URL) {
  adapter = getAdapter();
} else {
  adapter = createMemoryAdapter();
}

async function main() {
  try {
    console.log('Initializing database adapter...');
    // Ensure adapter is initialized
    const repos = createRepos(adapter);

    // Create a workspace
    console.log('Creating workspace...');
    const workspace = await repos.workspaces.create({
      name: 'TEOS DealMaker Self-Sell Mission',
      slug: 'selfsell-mission',
      plan: 'solo',
      status: 'active'
    });
    const workspaceId = workspace.id;
    console.log(`Workspace created with ID: ${workspaceId}`);

    // Create a user (founder)
    console.log('Creating founder user...');
    const user = await repos.users.create({
      email: 'founder@teos.dealmaker',
      display_name: 'Founder',
      telegram_id: null // not using Telegram
    });
    const userId = user.id;
    console.log(`User created with ID: ${userId}`);

    // Make user a member of the workspace with owner role
    await repos.members.add({
      workspace_id: workspaceId,
      user_id: userId,
      role: 'owner'
    });
    console.log('User added as owner to workspace.');

    // Optionally, set up some basic knowledge for the revenue strategist
    // We'll create a simple company knowledge document
    console.log('Adding company knowledge...');
    await repos.intelligence.add({
      workspace_id: workspaceId,
      title: 'Company Profile',
      source_type: 'profile',
      content: JSON.stringify({
        company_name: 'TEOS DealMaker',
        description: 'Enterprise AI Revenue Operating System',
        competitors: ['Traditional CRM platforms', 'Manual sales processes'],
        ideal_customer_profile: {
          industry: ['Technology', 'Finance', 'Healthcare'],
          company_size: 'mid-market',
          pain_points: ['Long sales cycles', 'Inconsistent lead generation', 'Lack of sales visibility']
        }
      }),
      metadata: { type: 'company' }
    });

    // Run the sales strategy mission (equivalent to Mission 1: Sell TEOS Dealmaker)
    console.log('Running sales strategy mission to sell TEOS DealMaker...');
    const result = await runtime.runSalesStrategy(adapter, workspaceId, {
      title: 'Sell TEOS Dealmaker - Self Initiated',
      priority: 'high'
    });

    console.log('\n=== MISSION RESULT ===');
    console.log(`Status: ${result.status}`);
    console.log(`Plan ID: ${result.plan.id}`);
    console.log(`Plan Title: ${result.plan.title}`);
    console.log(`Goal: ${result.plan.goal}`);

    // Print briefing if available
    if (result.briefing) {
      console.log('\n--- Executive Briefing ---');
      console.log(result.briefing);
    }

    // Print steps
    console.log('\n--- Steps Executed ---');
    for (const step of result.steps) {
      console.log(`${step.status.toUpperCase()}: ${step.agent_type} - ${step.step_key}`);
      if (step.output) {
        console.log(`  Output: ${String(step.output).substring(0, 100)}...`);
      }
    }

    // If mission is waiting for approval, auto-approve as founder and resume
    if (result.status === 'waiting_approval' && result.pendingApprovals && result.pendingApprovals.length > 0) {
      console.log('\n--- Auto-approving pending approval ---');
      const approval = result.pendingApprovals[0];
      console.log(`Approving request ID ${approval.requestId} for step ${approval.stepId} (agent: ${approval.agentType})`);
      const { decision, resumed, ...outcome } = await runtime.approveAndResume(adapter, workspaceId, approval.requestId, userId);
      console.log(`Approval decision: ${decision.status}`);
      console.log(`Resumed: ${resumed}`);
      if (resumed) {
        console.log('\n=== MISSION AFTER APPROVAL ===');
        console.log(`Status: ${outcome.status}`);
        console.log(`Plan ID: ${outcome.plan.id}`);
        console.log(`Plan Title: ${outcome.plan.title}`);
        if (outcome.briefing) {
          console.log('\n--- Executive Briefing ---');
          console.log(outcome.briefing);
        }
        console.log('\n--- Steps After Resume ---');
        for (const step of outcome.steps) {
          console.log(`${step.status.toUpperCase()}: ${step.agent_type} - ${step.step_key}`);
          if (step.output) {
            console.log(`  Output: ${String(step.output).substring(0, 100)}...`);
          }
        }
      } else {
        console.log('Failed to resume mission after approval.');
      }
    }

    console.log('\nProcess completed successfully!');
    return 0;
  } catch (err) {
    console.error('Error running mission:', err);
    process.exit(1);
  }
}

main();
