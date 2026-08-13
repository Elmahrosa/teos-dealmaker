'use strict';

const { getAdapter, createMemoryAdapter } = require('../db');
const identity = require('../services/identity');
const billing = require('../services/billing');
const { createRepos } = require('../db/repos');
const runtime = require('../services/workforce/runtime');

async function testTrialExperience() {
  let adapter;
  try {
    adapter = getAdapter();
  } catch (_err) {
    console.log('Using memory adapter for testing');
    adapter = createMemoryAdapter();
  }

  console.log('Testing trial experience via identity.onboardWorkspace...');

  try {
    const repos = createRepos(adapter);

    // Create a dummy owner user for the trial workspace
    const ownerUser = await repos.users.create({
      email: 'trialowner@example.com',
      display_name: 'Trial Owner',
      telegram_id: null,
      password_hash: 'dummyhash', // not used for auth in this test
      salt: 'dummysalt'
    });
    const ownerUserId = ownerUser.id;
    console.log(`������������������������������������������������������������ Created dummy owner user: ${ownerUserId}`);

    // Create trial workspace via identity.onboardWorkspace (this will activate subscription for trial)
    console.log('\n1. Creating trial workspace via onboardWorkspace...');
    const workspace = await identity.onboardWorkspace(adapter, {
      ownerUserId,
      companyName: 'Trial Company',
      plan: 'trial'
    });
    const workspaceId = workspace.id;
    console.log(`�������������������������������������������������������������������������������������������������������������������������������������������������������� Trial workspace created: ${workspaceId}`);

    // Get the subscription to verify it's active
    const subscription = await repos.subscriptions.get(workspaceId);
    console.log('   Subscription:', subscription);
    if (!subscription) {
      throw new Error('Subscription not found for trial workspace');
    }
    if (subscription.status !== 'active') {
      throw new Error(`Expected trial subscription to be active, got ${subscription.status}`);
    }
    console.log(`�������������������������������������������������������������������������������������������������������������������������������������������������������� Subscription is active: ${subscription.status}`);

    // Check entitlement (should be true)
    const entitledBefore = await billing.isEntitled(adapter, workspaceId);
    console.log(`���������������������������������������������������������������������������������������������������������������������������� Entitled before mission: ${entitledBefore} (should be true)`);
    if (!entitledBefore) {
      throw new Error('Expected entitled before mission');
    }

    // Run a mission (should succeed)
    console.log('\n2. Running first mission (should succeed)...');
    let missionResult;
    try {
      missionResult = await runtime.runPlan(adapter, workspaceId, {
        goal: 'Test mission for trial',
        title: 'Trial Mission 1',
        priority: 'normal'
      });
      console.log(`�������������������������������������������������������������������������������������������������������������������������������������������������������� Mission 1 status: ${missionResult.status}`);
      if (missionResult.status === 'completed') {
        console.log('�������������������������������������������������������������������������������������������������������������������������������������������������������� First mission completed successfully');
        // Check subscription after mission
        const subAfterFirst = await repos.subscriptions.get(workspaceId);
        console.log('   Subscription after first mission:', subAfterFirst);
        if (!subAfterFirst) {
          throw new Error('Subscription not found after first mission');
        }
        console.log(`�������������������������������������������������������������������������������������������������������������������������������������������������������� Missions used after first mission: ${subAfterFirst.missions_used}`);
        if (subAfterFirst.missions_used !== 1) {
          throw new Error(`Expected missions_used to be 1, got ${subAfterFirst.missions_used}`);
        }
      } else {
        throw new Error(`Mission 1 failed with status: ${missionResult.status}`);
      }
    } catch (err) {
      console.error('���������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������� Error running mission 1:', err.message);
      throw err;
    }

    // Check entitlement again (should be false now because limit reached)
    const entitledAfterFirst = await billing.isEntitled(adapter, workspaceId);
    console.log(`�������������������������������������������������������������������������������������������������������������������������������� Entitled after first mission: ${entitledAfterFirst} (should be false for trial with 1 used)`);
    if (entitledAfterFirst) {
      throw new Error('Expected not entitled after first mission');
    }

    // Try to run a second mission (should fail due to entitlement)
    console.log('\n3. Attempting second mission (should fail due to limit)...');
    let secondMissionFailed = false;
    try {
      await runtime.runPlan(adapter, workspaceId, {
        goal: 'Test mission for trial - second attempt',
        title: 'Trial Mission 2',
        priority: 'normal'
      });
    } catch (err) {
      if (err.message.includes('not entitled')) {
        secondMissionFailed = true;
        console.log('���������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������� Second mission correctly blocked: not entitled');
      } else {
        throw err;
      }
    }
    if (!secondMissionFailed) {
      throw new Error('Second mission should have failed but did not');
    }

    // Test 2: After subscription renewal, missions reset and can run again
    console.log('\n4. Simulating subscription renewal (reset missions used)...');
    await repos.subscriptions.update(subscription.id, {
      missions_used: 0,
      status: 'active',
      renewal_date: new Date(Date.now() + 30*24*60*60*1000).toISOString().slice(0, 10)
    });

    const renewedSub = await repos.subscriptions.get(workspaceId);
    console.log('   Subscription after reset:', renewedSub);
    if (!renewedSub) {
      throw new Error('Subscription not found after reset');
    }
    console.log(`���������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������� Renewed subscription missions used: ${renewedSub.missions_used}`);

    const entitledAfterReset = await billing.isEntitled(adapter, workspaceId);
    console.log(`������������������������������������������������������������������������������������������������������������������������������������ Entitled after reset: ${entitledAfterReset} (should be true)`);
    if (!entitledAfterReset) {
      throw new Error('Expected entitled after reset');
    }

    // Run a mission again (should succeed)
    console.log('\n5. Running mission after reset (should succeed)...');
    let missionResultAfterReset;
    try {
      missionResultAfterReset = await runtime.runPlan(adapter, workspaceId, {
        goal: 'Test mission for trial after reset',
        title: 'Trial Mission 3',
        priority: 'normal'
      });
      console.log(`�������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������� Mission 3 status: ${missionResultAfterReset.status}`);
      if (missionResultAfterReset.status === 'completed') {
        console.log('�������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������� Mission after reset completed successfully');
        // Check subscription after mission
        const subAfterThird = await repos.subscriptions.get(workspaceId);
        console.log('   Subscription after third mission:', subAfterThird);
        if (!subAfterThird) {
          throw new Error('Subscription not found after third mission');
        }
        console.log(`�������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������� Missions used after third mission: ${subAfterThird.missions_used}`);
        if (subAfterThird.missions_used !== 1) {
          throw new Error(`Expected missions_used to be 1 after reset, got ${subAfterThird.missions_used}`);
        }
      } else {
        throw new Error(`Mission 3 failed with status: ${missionResultAfterReset.status}`);
      }
    } catch (err) {
      console.error('�������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������� Error running mission after reset:', err.message);
      throw err;
    }

    console.log('\n��������������������������������������������������������������✅ All trial experience tests passed!');
    return true;
  } catch (err) {
    console.error('\n��������������������������������������������������������������❌ Trial experience test failed:', err.message);
    console.error(err.stack);
    return false;
  }
}

testTrialExperience().then(success => {
  process.exit(success ? 0 : 1);
});

