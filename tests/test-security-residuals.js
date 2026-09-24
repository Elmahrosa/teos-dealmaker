'use strict';

// Residual-finding closure tests (audit findings 8, 10, 14):
//   8  — founder derivation must come from the TELEGRAM id only. A signed-up
//        tenant whose auto-increment user.id collides with the numeric founder
//        telegram id must never inherit founder status, at identity.isFounderUser
//        or at the platform capability gate.
//   10 — the public /start/thanks confirmation must not echo submission content
//        (intake ids are sequential, so echoing would leak other customers'
//        briefs by enumeration).
//   14 — mission usage increment is bounded per request (no single-request
//        self-DoS on the workspace entitlement).

const assert = require('assert');

(async () => {
  // Isolate from any ambient production configuration.
  delete process.env.TEOS_FOUNDER_TELEGRAM_ID;
  delete process.env.TEOS_ENTERPRISE;
  delete process.env.ENTERPRISE_MODE;
  delete process.env.DATABASE_URL;

  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };
  const rejects = async (p, label) => {
    let threw = false;
    try { await p; } catch (_err) { threw = true; }
    ok(threw, label);
  };

  console.log('\n=== Residual finding closure · founder collision · intake disclosure · increment cap ===');

  const { createMemoryAdapter, createRepos } = require('../db');
  const identity = require('../services/identity');
  const { createPlatform } = require('../services/platform');
  const auth = require('../services/auth');
  const render = require('../server/render');

  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  // ---------------------------------------------------------------------
  // Finding 8 — founder is derived from the TELEGRAM id ONLY.
  // ---------------------------------------------------------------------
  // Drive the memory adapter directly so its shared sequence places the
  // collision user EXACTLY on id == FID.
  const FID = 4;
  process.env.TEOS_FOUNDER_TELEGRAM_ID = String(FID);
  const realFounder = adapter.insert('users', { telegram_id: FID, email: 'founder@teos.test' });   // id 1
  adapter.insert('users', { telegram_id: null, email: 'alice@teos.test' });                        // id 2
  adapter.insert('users', { telegram_id: 999, email: 'bob@teos.test' });                           // id 3
  const collision = adapter.insert('users', { telegram_id: 888, email: 'collision@teos.test' });   // id 4 == FID
  ok(collision.id === FID, 'fixture: collision user.id equals the numeric founder telegram id');
  ok(Number(realFounder.telegram_id) === FID && realFounder.id !== FID, 'fixture: real founder matches only by telegram id');

  ok(await identity.isFounderUser(adapter, realFounder.id) === true,
    'founder is recognized via telegram_id (users.id need not equal FID)');
  ok(await identity.isFounderUser(adapter, collision.id) === false,
    'numeric users.id == FID must NOT grant founder status (finding 8)');
  ok(await identity.isFounderUser(adapter, 2) === false, 'ordinary user is not founder');
  ok(await identity.isFounderUser(adapter, 999999) === false, 'unknown user is not founder');

  // The same guarantee at the platform capability gate (sibling pattern).
  const growthWs = repos.workspaces.create({ name: 'Growth Co', slug: 'growth-collision-co', plan: 'growth', status: 'active' });
  repos.subscriptions.create({ workspace_id: growthWs.id, plan: 'growth', status: 'active', cycle: 'monthly' });
  repos.members.add({ workspace_id: growthWs.id, user_id: realFounder.id, role: 'owner' });

  const platform = createPlatform({ repos, enterprise: true });

  const denied = await platform.canUseCapability({
    workspaceId: growthWs.id,
    userId: collision.id, // numeric users.id == FID, no telegram identity
    capability: 'custom.myplugin.run'
  });
  ok(denied.allowed === false && denied.reason === 'capability_not_entitled',
    'collision user.id is denied at the capability gate — no founder_bypass');
  ok(denied.reason !== 'founder_bypass', 'platform gate never grants founder on a bare numeric id');

  const founderGate = await platform.canUseCapability({
    workspaceId: growthWs.id,
    userId: collision.id,
    requester: { telegram_id: FID },
    capability: 'custom.myplugin.run'
  });
  ok(founderGate.allowed === true && founderGate.reason === 'founder_bypass' && founderGate.founder === true,
    'an explicit telegram identity still grants the founder capability bypass');

  // ---------------------------------------------------------------------
  // Finding 10 — public intake confirmation echoes NO submission content.
  // ---------------------------------------------------------------------
  const html = render.renderStartThanks({
    id: 42,
    status: 'received',
    title: 'LEAK-TITLE-MARKER',
    objective: 'LEAK-OBJECTIVE-MARKER',
    outcome: 'LEAK-OUTCOME-MARKER',
    contact: 'LEAK-CONTACT@example.com',
    created_at: '2026-01-01T00:00:00Z'
  });
  ok(html.includes('intake #42'), 'thanks page confirms the intake reference');
  ok(html.includes('LEAK-TITLE-MARKER') === false, 'intake title is not echoed on the public page');
  ok(html.includes('LEAK-OBJECTIVE-MARKER') === false, 'intake objective is not echoed');
  ok(html.includes('LEAK-OUTCOME-MARKER') === false, 'intake outcome is not echoed');
  ok(html.includes('LEAK-CONTACT@example.com') === false, 'intake contact is not echoed');
  ok(html.includes('<h2>Mission brief</h2>') === false, 'no mission-brief recap block on the public page');

  // ---------------------------------------------------------------------
  // Finding 14 — mission usage increment is bounded per request.
  // ---------------------------------------------------------------------
  const capped = await auth.incrementUserMissionUsage(adapter, realFounder.id, 5);
  ok(capped && capped.missions_used === 5, 'a bounded increment applies normally');

  await rejects(auth.incrementUserMissionUsage(adapter, realFounder.id, 1000),
    'a 1000-mission single request is rejected (cap)');
  await rejects(auth.incrementUserMissionUsage(adapter, realFounder.id, 0),
    'zero increment is rejected');
  await rejects(auth.incrementUserMissionUsage(adapter, realFounder.id, -3),
    'negative increment is rejected');
  await rejects(auth.incrementUserMissionUsage(adapter, realFounder.id, 'abc'),
    'non-numeric increment is rejected');

  console.log(`\n✓ residual findings closed (${passed} assertions passed)`);
  process.exit(0);
})().catch((err) => {
  console.error('[test-security-residuals] fatal:', err.message);
  process.exit(1);
});
