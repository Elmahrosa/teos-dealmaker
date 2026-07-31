const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');

(async () => {
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  const tgA = 1001;
  const tgB = 1002;

  const userA = await identity.ensureUser(adapter, tgA, { display_name: 'Founder A' });
  assert.ok(userA.id, 'userA created');
  assert.strictEqual(userA.telegram_id, tgA, 'telegram_id stored');

  const userAAgain = await identity.ensureUser(adapter, tgA);
  assert.strictEqual(userAAgain.id, userA.id, 'ensureUser is idempotent');

  const byTg = await identity.getUserByTelegram(adapter, tgA);
  assert.strictEqual(byTg.id, userA.id, 'getUserByTelegram resolves same user');

  const wsA = await identity.onboardWorkspace(adapter, {
    ownerUserId: userA.id,
    companyName: 'Acme Corp',
    lang: 'en',
    plan: 'growth'
  });
  assert.ok(wsA.id, 'workspace created');
  assert.ok(/^acme-corp/.test(wsA.slug), `slug derived from name, got ${wsA.slug}`);
  assert.strictEqual(wsA.owner_user_id, userA.id, 'owner_user_id wired');
  assert.strictEqual(wsA.plan, 'growth', 'plan wired');

  const sub = await repos.subscriptions.get(wsA.id);
  assert.ok(sub, 'subscription created');
  assert.strictEqual(sub.plan, 'growth', 'subscription plan matches');
  assert.strictEqual(sub.status, 'pending', 'subscription pending');
  assert.strictEqual(wsA.subscription_id, sub.id, 'workspace.subscription_id wired');

  const member = await repos.members.list(wsA.id);
  assert.strictEqual(member[0].user_id, userA.id, 'owner membership created');
  assert.strictEqual(member[0].role, 'owner', 'owner role set');

  const agents = await repos.agents.list(wsA.id);
  assert.strictEqual(agents.length, identity.AGENT_TYPES.length, 'all agents provisioned');
  const types = new Set(agents.map(a => a.agent_type));
  assert.strictEqual(types.size, identity.AGENT_TYPES.length, 'agent types unique');
  assert.ok(types.has('orchestrator') && types.has('closing'), 'expected agents present');

  const settings = await repos.settings.getByWorkspace(wsA.id);
  assert.ok(settings, 'workspace settings created');
  assert.strictEqual(settings.lang, 'en', 'settings lang matches');

  const wsByUser = await identity.getWorkspaceForUser(adapter, userA.id);
  assert.strictEqual(wsByUser.id, wsA.id, 'getWorkspaceForUser resolves');

  const wsB = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.ensureUser(adapter, tgB)).id,
    companyName: 'Acme Corp',
    lang: 'ar',
    plan: 'solo'
  });
  assert.notStrictEqual(wsB.slug, wsA.slug, 'slug collision avoided');
  assert.strictEqual(wsB.slug, 'acme-corp-2', `second slug suffixed, got ${wsB.slug}`);

  const agentsB = await repos.agents.list(wsB.id);
  const settingsB = await repos.settings.getByWorkspace(wsB.id);
  assert.strictEqual(settingsB.lang, 'ar', 'second workspace language independent');
  assert.notStrictEqual(agentsB[0].id, agents[0].id, 'agent rows isolated per workspace');

  const auditRows = await repos.audit.list(wsA.id);
  const provisionEvent = auditRows.find(a => a.action_type === 'WORKSPACE_PROVISIONED');
  assert.ok(provisionEvent, 'provision audit event recorded');
  assert.strictEqual(provisionEvent.workspace_id, wsA.id, 'provision event scoped to workspace');

  const userB = await identity.getUserByTelegram(adapter, tgB);
  const wsBFromUser = await identity.getWorkspaceForUser(adapter, userB.id);
  assert.strictEqual(wsBFromUser.id, wsB.id, 'user B resolves to workspace B');

  console.log(`\n✓ identity (${27} assertions passed)`);
  console.log(`  agents: ${agents.length}, slug "${wsA.slug}" / "${wsB.slug}"`);
  process.exit(0);
})().catch(err => {
  console.error('✗ identity test failed:', err);
  process.exit(1);
});
