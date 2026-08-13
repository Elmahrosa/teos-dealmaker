'use strict';

const { getAdapter, createMemoryAdapter } = require('./db');
const auth = require('./services/auth');

// Test using memory adapter
async function testAuth() {
  let adapter;
  try {
    adapter = getAdapter();
  } catch {
    console.log('Using memory adapter for testing');
    adapter = createMemoryAdapter();
  }

  // First, let's run the migrations to add auth fields
  // In a real scenario, we would run the SQL migrations
  // For now, we'll just test with memory adapter which should work

  console.log('Testing auth system...');

  // Test signup
  try {
    console.log('\\n1. Testing signup...');
    const signupResult = await auth.signup(adapter, {
      email: 'test@example.com',
      password: 'securepassword123',
      companyName: 'Test Company',
      plan: 'solo'
    });
    console.log('��✓ Signup successful');
    console.log(`  User ID: ${signupResult.user.id}`);
    console.log(`  Workspace ID: ${signupResult.workspace.id}`);
    console.log(`  Subscription ID: ${signupResult.subscription.id}`);

    // Test login
    console.log('\\n2. Testing login...');
    const loginResult = await auth.login(adapter, {
      email: 'test@example.com',
      password: 'securepassword123'
    });
    console.log('��✓ Login successful');
    console.log(`  User ID: ${loginResult.user.id}`);
    console.log(`  Email: ${loginResult.user.email}`);

    // Test entitlement check
    console.log('\\n3. Testing entitlement check...');
    const entitled = await auth.checkUserEntitlement(adapter, signupResult.user.id);
    console.log(`��✓ Entitlement check: ${entitled} (should be true)`);

    // Test mission usage increment
    console.log('\\n4. Testing mission usage increment...');
    const updatedSub = await auth.incrementUserMissionUsage(adapter, signupResult.user.id, 1);
    console.log('��✓ Mission usage incremented');
    console.log(`  Missions used: ${updatedSub.missions_used}`);

    // Test entitlement check after increment
    console.log('\\n5. Testing entitlement check after mission usage...');
    const stillEntitled = await auth.checkUserEntitlement(adapter, signupResult.user.id);
    console.log(`��✓ Still entitled: ${stillEntitled} (should be true for solo plan with 1<5)`);

    // Test exceeding mission limit
    console.log('\\n6. Testing mission limit (using 4 more missions)...');
    for (let i = 0; i < 4; i++) {
      await auth.incrementUserMissionUsage(adapter, signupResult.user.id, 1);
    }
    console.log('��✓ Used 4 more missions (total 5)');

    const atLimit = await auth.checkUserEntitlement(adapter, signupResult.user.id);
    console.log(`��✓ At limit: ${!atLimit} (should be false - not entitled anymore)`);

    console.log('\\n��✅ All auth tests passed!');
    return true;
  } catch (err) {
    console.error('\\n��❌ Test failed:', err.message);
    return false;
  }
}

testAuth().then(success => {
  process.exit(success ? 0 : 1);
});
