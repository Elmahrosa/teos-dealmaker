const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');
const { getWorkspaceContext, setWorkspaceLang, subscriptionLabel } = require('../services/workspace');

(async () => {
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  assert.strictEqual(subscriptionLabel('pending'), 'Trialing');
  assert.strictEqual(subscriptionLabel('active'), 'Active');

  const tgA = 2001;
  const tgB = 2002;
  const owner = await identity.ensureUser(adapter, tgA, { display_name: 'Owner A' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: owner.id,
    companyName: 'Acme Ltd',
    lang: 'en',
    plan: 'growth'
  });

  let ctx = await getWorkspaceContext(adapter, tgA);
  assert.ok(ctx, 'context resolves for owner');
  assert.strictEqual(ctx.workspace.name, 'Acme Ltd', 'workspace name');
  assert.strictEqual(ctx.role, 'owner', 'owner role');
  assert.strictEqual(ctx.membersCount, 1, 'one member');
  assert.strictEqual(ctx.agents.total, 12, '12 agents provisioned');
  assert.strictEqual(ctx.agents.active, 12, 'all active');
  assert.strictEqual(ctx.deals.total, 0, 'empty revenue pipeline');
  assert.strictEqual(ctx.deals.open, 0, 'zero open');
  assert.strictEqual(ctx.deals.closed, 0, 'zero closed');
  assert.strictEqual(ctx.subscriptionLabel, 'Trialing', 'pending subscription shows Trialing');
  assert.strictEqual(ctx.settings.lang, 'en', 'workspace settings lang');
  assert.strictEqual(ctx.workspace.subscription_id, ctx.subscription.id, 'subscription linked');

  const memberB = await identity.ensureUser(adapter, tgB);
  await identity.addMember(adapter, { workspaceId: ws.id, userId: memberB.id, role: 'operator' });
  ctx = await getWorkspaceContext(adapter, tgB);
  assert.strictEqual(ctx.role, 'operator', 'member role resolved');
  assert.strictEqual(ctx.membersCount, 2, 'two members after invite');

  await repos.deals.create({ workspace_id: ws.id, company_name: 'Fawry', stage: 'qualified', status: 'open' });
  await repos.deals.create({ workspace_id: ws.id, company_name: 'Nexus', stage: 'closing', status: 'open' });
  await repos.deals.create({ workspace_id: ws.id, company_name: 'ClosedCo', stage: 'won', status: 'won' });
  ctx = await getWorkspaceContext(adapter, tgA);
  assert.strictEqual(ctx.deals.total, 3, 'deals counted');
  assert.strictEqual(ctx.deals.open, 2, 'two open');
  assert.strictEqual(ctx.deals.closed, 1, 'one closed');

  await setWorkspaceLang(adapter, ws.id, 'ar');
  ctx = await getWorkspaceContext(adapter, tgA);
  assert.strictEqual(ctx.settings.lang, 'ar', 'workspace language persisted');

  const other = await identity.ensureUser(adapter, 2003);
  const otherCtx = await getWorkspaceContext(adapter, 2003);
  assert.strictEqual(otherCtx, null, 'user without workspace has no context');

  const wsB = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.ensureUser(adapter, 2004)).id,
    companyName: 'Beta Ltd',
    lang: 'en',
    plan: 'solo'
  });
  const ctxB = await getWorkspaceContext(adapter, 2004);
  assert.strictEqual(ctxB.deals.total, 0, 'second workspace pipeline isolated');
  assert.notStrictEqual(ctxB.workspace.id, ws.id, 'distinct workspace');

  const roleCtx = await getWorkspaceContext(adapter, tgB);
  assert.strictEqual(roleCtx.workspace.id, ws.id, 'member scoped to correct workspace');

  console.log(`\n✓ workspace dashboard (${24} assertions passed)`);
  console.log(`  ${ctx.workspace.name}: ${ctx.membersCount} members · ${ctx.agents.active} agents active · ${ctx.deals.open} open / ${ctx.deals.closed} closed · ${ctx.subscriptionLabel}`);
  process.exit(0);
})().catch(err => {
  console.error('✗ workspace test failed:', err);
  process.exit(1);
});
