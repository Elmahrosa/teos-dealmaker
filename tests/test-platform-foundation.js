const assert = require('assert');

(async () => {
  delete process.env.TEOS_ENTERPRISE;
  delete process.env.ENTERPRISE_MODE;
  delete process.env.DATABASE_URL;
  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };

  console.log('\n=== Platform governance · 5A foundation (tenants + entitlements + authorization) ===');

  const { createMemoryAdapter, createRepos } = require('../db');
  const { createPlatform } = require('../services/platform');

  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  // ------------------------------------------------------------- fixtures
  const freeWs = repos.workspaces.create({ name: 'Free Co', slug: 'free-co', plan: 'free', status: 'active' });
  const growthWs = repos.workspaces.create({ name: 'Growth Co', slug: 'growth-co', plan: 'growth', status: 'active' });
  const corpWs = repos.workspaces.create({ name: 'Corp Co', slug: 'corp-co', plan: 'corporate', status: 'active' });
  const entWs = repos.workspaces.create({ name: 'Ent Co', slug: 'ent-co', plan: 'enterprise', status: 'active' });
  const suspWs = repos.workspaces.create({ name: 'Suspended Co', slug: 'susp-co', plan: 'growth', status: 'suspended' });

  repos.subscriptions.create({ workspace_id: growthWs.id, plan: 'growth', status: 'active', cycle: 'monthly' });
  repos.subscriptions.create({ workspace_id: corpWs.id, plan: 'corporate', status: 'canceled', cycle: 'annual' });

  const userA = repos.users.create({ email: 'a@acme.com' });
  const userB = repos.users.create({ email: 'b@acme.com' });
  repos.members.add({ workspace_id: growthWs.id, user_id: userA.id, role: 'owner' });

  const platform = createPlatform({ repos, enterprise: true });

  // ------------------------------------------------------- resolve* facade
  const ws = await platform.resolveWorkspace(growthWs.id);
  ok(ws && ws.id === growthWs.id && ws.plan === 'growth', 'resolveWorkspace returns the workspace row');
  ok(await platform.resolveWorkspace('nope') === null, 'resolveWorkspace null for unknown id');

  const tenant = await platform.resolveTenant(growthWs.id);
  ok(tenant.ok && tenant.plan === 'growth' && tenant.active === true, 'resolveTenant resolves plan + status');
  ok(tenant.subscription.status === 'active', 'resolveTenant carries the subscription');
  ok((await platform.resolveTenant('nope')).error === 'tenant_not_found', 'resolveTenant reports unknown tenant');
  ok((await platform.resolveTenant(suspWs.id)).active === false, 'resolveTenant flags inactive workspace');

  const sub = await platform.resolveSubscription(growthWs.id);
  ok(sub && sub.plan === 'growth' && sub.status === 'active', 'resolveSubscription returns subscription');
  ok(await platform.resolveSubscription(freeWs.id) === null, 'resolveSubscription null when none exists');

  const plan = await platform.resolvePlan(growthWs.id);
  ok(plan.ok && plan.plan === 'growth' && plan.limits.seats === 10, 'resolvePlan returns catalog limits');
  ok((await platform.resolvePlan('nope')).error === 'tenant_not_found', 'resolvePlan reports unknown tenant');

  // ------------------------------------------------------------ entitlements
  ok((await platform.entitlements.license(growthWs.id)).valid === true, 'active subscription + workspace = valid license');
  const corpLic = await platform.entitlements.license(corpWs.id);
  ok(corpLic.valid === false && corpLic.subscriptionValid === false, 'canceled subscription invalidates license');
  const suspLic = await platform.entitlements.license(suspWs.id);
  ok(suspLic.valid === false && suspLic.subscriptionValid === true, 'inactive workspace invalidates license');

  // seats
  const seats = await platform.entitlements.checkSeats(growthWs.id);
  ok(seats.ok === true && seats.remaining === 9, 'growth seats: 1 of 10 used, 9 remaining');
  const freeSeats = await platform.entitlements.checkSeats(freeWs.id);
  ok(freeSeats.ok === true && freeSeats.limit === 1, 'free plan caps at one seat');
  repos.members.add({ workspace_id: freeWs.id, user_id: userB.id, role: 'operator' });
  ok((await platform.entitlements.checkSeats(freeWs.id)).ok === false, 'free plan seat limit enforced');
  const entSeats = await platform.entitlements.checkSeats(entWs.id);
  ok(entSeats.ok === true && entSeats.remaining === null, 'enterprise seats unlimited');

  // agents
  for (const name of ['prospecting', 'qualification', 'outreach']) {
    repos.agents.create({ workspace_id: freeWs.id, agent_type: name, status: 'active' });
  }
  const freeAgents = await platform.entitlements.checkAgents(freeWs.id);
  ok(freeAgents.ok === false && freeAgents.limit === 3, 'free plan agent limit enforced at 3');
  ok((await platform.entitlements.checkAgents(entWs.id)).ok === true, 'enterprise agents unlimited');

  // capability scope
  ok((await platform.entitlements.checkCapability(freeWs.id, 'sentinel.scan')).error === 'capability_not_entitled',
    'free plan has no plugin scope');
  ok((await platform.entitlements.checkCapability(growthWs.id, 'sentinel.scan')).allowed === true,
    'growth plan grants plugin scope');
  ok((await platform.entitlements.checkCapability(growthWs.id, 'custom.myplugin.run')).error === 'capability_not_entitled',
    'growth plan has no custom scope');
  ok((await platform.entitlements.checkCapability(corpWs.id, 'custom.myplugin.run')).allowed === true,
    'corporate plan grants custom scope');
  ok((await platform.entitlements.checkCapability(entWs.id, 'custom.myplugin.run')).allowed === true,
    'enterprise grants everything');

  // plugin install
  ok((await platform.entitlements.checkPluginInstall(freeWs.id, 'civic-mixer')).error === 'plugin_not_entitled',
    'free plan cannot install first-party plugins');
  ok((await platform.entitlements.checkPluginInstall(growthWs.id, 'civic-mixer')).allowed === true,
    'growth plan installs civic-mixer');
  ok((await platform.entitlements.checkPluginInstall(growthWs.id, 'github')).error === 'plugin_not_entitled',
    'growth plan denies unlisted plugin');
  ok((await platform.entitlements.checkPluginInstall(entWs.id, 'github')).allowed === true,
    'enterprise installs any plugin');

  // usage quota
  repos.usage.record({ workspace_id: freeWs.id, provider: 'anthropic', model: 'claude', input_tokens: 1000, output_tokens: 500, cost_cents: 600 });
  const freeUsage = await platform.checkQuota(freeWs.id);
  ok(freeUsage.ok === false && freeUsage.error === 'usage_quota_exceeded', 'free plan cost quota enforced');
  repos.usage.record({ workspace_id: growthWs.id, provider: 'anthropic', model: 'claude', input_tokens: 1000, output_tokens: 500, cost_cents: 100 });
  const growthUsage = await platform.checkQuota(growthWs.id);
  ok(growthUsage.ok === true && growthUsage.limit.cost_cents_month === 15000, 'growth usage within quota');
  ok((await platform.checkQuota(entWs.id)).unlimited === true, 'enterprise usage unlimited');

  // ------------------------------------------------------------ authorization
  const auth = platform.authorization;
  ok(auth.roles.includes('viewer') && auth.roles.includes('owner'), 'roles ordered owner..viewer');
  ok((await auth.authorize({ workspaceId: growthWs.id, userId: userA.id, capability: 'sentinel.scan' })).allowed === true,
    'owner executes sentinel.scan');
  ok((await auth.authorize({ workspaceId: growthWs.id, role: 'viewer', capability: 'sentinel.audit' })).reason === 'insufficient_role',
    'viewer denied sentinel.audit');
  ok((await auth.authorize({ workspaceId: growthWs.id, role: 'viewer', capability: 'sentinel.rules.list' })).allowed === true,
    'viewer reads sentinel rules');
  ok((await auth.authorize({ workspaceId: growthWs.id, role: 'operator', capability: 'sentinel.policy.check' })).allowed === true,
    'operator checks policy');
  ok((await auth.authorize({ workspaceId: growthWs.id, userId: userB.id, capability: 'sentinel.scan' })).reason === 'not_workspace_member',
    'non-member denied even with valid role path');
  ok((await auth.authorize({ workspaceId: growthWs.id, role: 'viewer', capability: 'billing.invoice.list' })).allowed === true,
    'read-suffix capabilities default to viewer');
  ok((await auth.authorize({ workspaceId: growthWs.id, role: 'viewer', capability: 'billing.invoice.void' })).reason === 'insufficient_role',
    'non-read capabilities default to operator');
  ok((await auth.authorize({ workspaceId: growthWs.id, capability: 'sentinel.scan' })).reason === 'insufficient_role',
    'system (no user, no role) falls back to least-privilege viewer');
  ok((await auth.authorize({ workspaceId: growthWs.id, role: 'operator', capability: 'sentinel.scan' })).allowed === true,
    'explicit operator role executes scan');
  ok((await auth.authorize({ workspaceId: null, role: 'owner', capability: 'sentinel.scan' })).reason === 'workspace_required',
    'authorization requires a workspace');

  auth.setOverride(growthWs.id, 'sentinel.scan', false, 'workspace_hold');
  ok((await auth.authorize({ workspaceId: growthWs.id, role: 'owner', capability: 'sentinel.scan' })).allowed === false,
    'workspace override can deny even an owner');
  auth.clearOverride(growthWs.id, 'sentinel.scan');
  ok((await auth.authorize({ workspaceId: growthWs.id, role: 'owner', capability: 'sentinel.scan' })).allowed === true,
    'workspace override cleared');

  // ---------------------------------------------------------- canUseCapability
  const gate = await platform.canUseCapability({ workspaceId: growthWs.id, userId: userA.id, capability: 'sentinel.scan' });
  ok(gate.allowed === true && gate.plan === 'growth', 'full gate allows entitled owner capability');
  const gateDenied = await platform.canUseCapability({ workspaceId: growthWs.id, role: 'viewer', capability: 'sentinel.audit' });
  ok(gateDenied.allowed === false && gateDenied.reason === 'insufficient_role', 'full gate enforces RBAC');
  const gatePlan = await platform.canUseCapability({ workspaceId: freeWs.id, capability: 'sentinel.scan' });
  ok(gatePlan.allowed === false && gatePlan.reason === 'capability_not_entitled', 'full gate enforces plan scope');
  const gateLicense = await platform.canUseCapability({ workspaceId: corpWs.id, capability: 'sentinel.scan' });
  ok(gateLicense.allowed === false && gateLicense.reason === 'subscription_inactive', 'full gate enforces license');
  const gateUnknown = await platform.canUseCapability({ workspaceId: 'nope', capability: 'sentinel.scan' });
  ok(gateUnknown.allowed === false && gateUnknown.reason === 'tenant_not_found', 'full gate rejects unknown tenant');

  // ---------------------------------------------------------- enterprise flag
  const inert = createPlatform({ repos });
  ok(inert.isEnterprise() === false, 'platform inert by default (no env)');
  const gateInert = await inert.canUseCapability({ workspaceId: corpWs.id, capability: 'sentinel.scan' });
  ok(gateInert.allowed === true && gateInert.reason === 'platform_inert', 'enterprise off short-circuits the gate');
  process.env.TEOS_ENTERPRISE = 'true';
  ok(createPlatform({ repos }).isEnterprise() === true, 'TEOS_ENTERPRISE=true enables the platform');
  delete process.env.TEOS_ENTERPRISE;

  // --------------------------------------------------------- MCP gate wiring
  const mcp = require('../services/mcp');
  ok(mcp.platform && typeof mcp.platform.canUseCapability === 'function', 'MCP facade exposes the platform');
  ok(mcp.platform.isEnterprise() === false, 'MCP platform inert in this process');

  const enterpriseClient = mcp.createClient({
    registry: mcp.registry,
    policy: mcp.policy,
    adapter: mcp.adapter,
    adapters: mcp.adapters,
    platform: createPlatform({ repos, enterprise: true }),
    enabled: true
  });
  const allowedExec = await enterpriseClient.call('sentinel.scan', {}, { workspaceId: growthWs.id, userId: userA.id });
  ok(allowedExec.ok === true, 'enterprise gate lets an entitled owner execute');
  const deniedExec = await enterpriseClient.call('sentinel.audit', {}, { workspaceId: growthWs.id, role: 'viewer' });
  ok(deniedExec.ok === false && deniedExec.reason === 'insufficient_role', 'enterprise gate blocks RBAC-denied execution');
  const licenseExec = await enterpriseClient.call('sentinel.scan', {}, { workspaceId: corpWs.id });
  ok(licenseExec.ok === false && licenseExec.reason === 'subscription_inactive', 'enterprise gate blocks license-invalid execution');

  console.log(`✓ platform foundation (${passed} assertions passed)`);
  console.log('  resolveWorkspace/Tenant/Subscription/Plan · entitlements (seats/agents/scope/plugins/usage) · RBAC · canUseCapability · executeCapability gate');
  process.exit(0);
})().catch(err => {
  console.error('✗ platform foundation test failed:', err);
  process.exit(1);
});
