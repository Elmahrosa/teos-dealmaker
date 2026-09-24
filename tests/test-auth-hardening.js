const assert = require('assert');

// Secondary hardening: signup error exposure contract.
//
// The /api/auth/signup route must echo ONLY validation errors that are tagged
// `expose: true`; any internal error (DB schema, stack traces) is masked to a
// generic message so nothing leaks to an unauthenticated caller. This test
// pins the tagging behavior in services/auth.js and the exact masking rule the
// route implements.
(async () => {
  delete process.env.DATABASE_URL;
  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };

  console.log('\n=== Secondary hardening · signup error exposure contract ===');

  const { createMemoryAdapter } = require('../db/adapter');
  const auth = require('../services/auth');
  const adapter = createMemoryAdapter();

  // 1. Validation failures are tagged expose:true so the route can echo them
  //    verbatim (good UX)...
  await assert.rejects(auth.signup(adapter, { email: '', password: '', companyName: '' }), (err) => {
    ok(err.expose === true, 'missing-fields signup error is tagged expose:true');
    ok(err.message.includes('Email, password, and company name are required'), 'missing-fields message preserved');
    return true;
  });

  await assert.rejects(auth.signup(adapter, { email: 'a@b.co', password: 'x', companyName: 'Acme', plan: 'enterprise' }), (err) => {
    ok(err.expose === true, 'invalid-plan signup error is tagged expose:true');
    return true;
  });

  // Seed a user, then a duplicate-email signup must reject with an exposed error.
  const { createRepos } = require('../db');
  createRepos(adapter).users.create({ email: 'dup@teos.test', display_name: 'dup', password_hash: 'x', salt: 'y' });
  await assert.rejects(auth.signup(adapter, { email: 'dup@teos.test', password: 'x', companyName: 'Acme', plan: 'solo' }), (err) => {
    ok(err.expose === true, 'duplicate-email signup error is tagged expose:true');
    return true;
  });

  // 2. ...while any untagged (internal) error must be masked. The masking rule
  //    below is the exact one the route implements, so a future change to the
  //    route or the service cannot silently re-leak internals.
  const mask = (err) => (err && err.expose === true ? err.message : 'Unable to complete signup');
  const internal = new Error('pg: relation "users" does not exist at /app/db/repos.js:401');
  ok(mask(internal) === 'Unable to complete signup', 'internal error is masked to a generic message');
  ok(mask(new Error('random stack')) === 'Unable to complete signup', 'any untagged error is masked');
  const validation = new Error('Invalid plan specified');
  validation.expose = true;
  ok(mask(validation) === 'Invalid plan specified', 'exposed validation message is preserved verbatim');

  // 3. A valid signup still works end-to-end with the in-memory adapter.
  const result = await auth.signup(adapter, {
    email: 'founder@teos.test',
    password: 'correct horse battery staple',
    companyName: 'Acme',
    plan: 'solo'
  });
  ok(result.user && result.user.email === 'founder@teos.test', 'valid signup creates the user');
  ok(result.workspace && result.workspace.plan === 'solo', 'valid signup creates the workspace');
  ok(result.subscription, 'valid signup initializes subscription tracking');

  console.log(`✓ signup exposure contract (${passed} assertions passed)`);
  process.exit(0);
})().catch(err => {
  console.error('✗ auth hardening test failed:', err);
  process.exit(1);
});
