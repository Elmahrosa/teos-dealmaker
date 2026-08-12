const assert = require('assert');

(async () => {
  delete process.env.TEOS_ENTERPRISE;
  delete process.env.ENTERPRISE_MODE;
  delete process.env.DATABASE_URL;
  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };

  console.log('\n=== Platform governance · 5B policy engine ===');

  const { createMemoryAdapter, createRepos } = require('../db');
  const { createPlatform, createPolicyEngine } = require('../services/platform');

  // ------------------------------------------------------------------ engine
  const engine = createPolicyEngine();
  ok(typeof engine.evaluate === 'function', 'engine exposes evaluate');
  ok(Array.isArray(engine.list()) && engine.list().length === 2, 'sentinel governance pack auto-registers');
  ok(engine.list().every((r) => r.scope === 'sentinel.scan|sentinel.audit' || r.scope === 'sentinel.policy.check'),
    'sentinel pack rules are capability-scoped');

  const allowed = await engine.evaluate({ capability: 'sentinel.scan', workspaceId: 'ws-1' });
  ok(allowed.allowed === true && allowed.reason === 'policy_allow_all', 'no matching rule -> allow');
  const deniedWs = await engine.evaluate({ capability: 'sentinel.audit' });
  ok(deniedWs.allowed === false && deniedWs.reason === 'sentinel_workspace_required',
    'sentinel governance denies audit without a workspace');
  const deniedTool = await engine.evaluate({ capability: 'sentinel.policy.check', workspaceId: 'ws-1', payload: {} });
  ok(deniedTool.allowed === false && deniedTool.reason === 'sentinel_tool_required',
    'sentinel governance denies policy.check without a target tool');
  const allowedTool = await engine.evaluate({ capability: 'sentinel.policy.check', workspaceId: 'ws-1', payload: { toolId: 'slack.postMessage' } });
  ok(allowedTool.allowed === true, 'policy.check with a target tool is allowed');
  ok(Array.isArray(deniedWs.trace) && deniedWs.trace.length > 0, 'decision carries an evaluation trace');
  ok(deniedWs.policy === 'sentinel.workspace_required' && deniedWs.rule === 'sentinel.workspace_required',
    'denied decision names the deciding rule');

  // --------------------------------------------------------------- registry
  const register = engine.register({ id: 'test.everything_denied', name: 'Test deny', scope: '*', priority: 1, fn: () => ({ allowed: false, reason: 'test_denied' }) });
  ok(register.ok === true, 'custom rule registers');
  ok(engine.get('test.everything_denied').priority === 1, 'priority read back');
  ok(engine.list().length === 3, 'custom rule listed');
  ok((await engine.evaluate({ capability: 'civic.lookup', workspaceId: 'ws-1' })).reason === 'test_denied',
    'deny-wins: highest-priority deny short-circuits');
  engine.disable('test.everything_denied');
  ok((await engine.evaluate({ capability: 'civic.lookup', workspaceId: 'ws-1' })).allowed === true,
    'disabled rule no longer applies');
  engine.enable('test.everything_denied');
  engine.unregister('test.everything_denied');
  ok(engine.get('test.everything_denied') === null, 'rule unregisters');
  ok(engine.register({ id: 'x' }).ok === false, 'registration requires an id and a function');
  ok(engine.unregister('nope').ok === false, 'unregister of unknown rule reports failure');

  // ------------------------------------------------- fail-closed on errors
  engine.register({
    id: 'test.broken',
    name: 'Broken rule',
    priority: 1,
    fn: () => { throw new Error('boom'); }
  });
  const broken = await engine.evaluate({ capability: 'civic.lookup', workspaceId: 'ws-1' });
  ok(broken.allowed === false && broken.reason === 'policy_rule_error', 'a throwing rule fails closed');
  engine.unregister('test.broken');

  // ------------------------------------------------------------------- audit
  const repos = createRepos(createMemoryAdapter());
  const auditEngine = createPolicyEngine({ repos });
  await auditEngine.evaluate({ capability: 'sentinel.scan', workspaceId: 'ws-1', requester: 'tester' });
  const auditEntries = auditEngine.audit.list();
  ok(auditEntries.length === 1 && auditEntries[0].decision === 'allow', 'engine audit records the decision');
  const persisted = await repos.audit.list('ws-1');
  ok(persisted.some((a) => a.action_type === 'POLICY_ALLOW'), 'policy decisions persist to the audit trail');

  // ------------------------------------------- platform gate (policies layer)
  const adapter = createMemoryAdapter();
  const prepos = createRepos(adapter);
  const ws = prepos.workspaces.create({ name: 'Gov Co', slug: 'gov-co', plan: 'growth', status: 'active' });
  prepos.subscriptions.create({ workspace_id: ws.id, plan: 'growth', status: 'active' });
  const user = prepos.users.create({ email: 'owner@gov.co' });
  prepos.members.add({ workspace_id: ws.id, user_id: user.id, role: 'owner' });

  const platform = createPlatform({ repos: prepos, enterprise: true });
  ok(platform.policies && typeof platform.policies.evaluate === 'function', 'platform exposes the policy engine');

  const gateOk = await platform.canUseCapability({ workspaceId: ws.id, userId: user.id, capability: 'sentinel.scan', payload: {} });
  ok(gateOk.allowed === true, 'gate passes when no policy rule applies');
  const gatePolicy = await platform.canUseCapability({ workspaceId: ws.id, userId: user.id, capability: 'sentinel.policy.check', payload: {} });
  ok(gatePolicy.allowed === false && gatePolicy.reason === 'sentinel_tool_required' && gatePolicy.policy === 'sentinel.tool_required',
    'policy engine denies at the capability gate');

  const held = createPlatform({ repos: prepos, enterprise: true });
  held.policies.register({ id: 'gov.workspace_hold', name: 'Workspace hold', scope: 'sentinel.scan', priority: 1, fn: (r) => (r.workspaceId === ws.id ? { allowed: false, reason: 'gov_hold' } : null) });
  const gateHold = await platform.canUseCapability({ workspaceId: ws.id, userId: user.id, capability: 'sentinel.scan', payload: {} });
  ok(gateHold.allowed === true, 'unrelated platform instance unaffected by another instance rule');
  const gateHold2 = await held.canUseCapability({ workspaceId: ws.id, userId: user.id, capability: 'sentinel.scan', payload: {} });
  ok(gateHold2.allowed === false && gateHold2.reason === 'gov_hold', 'registered policy deny enforced at the gate');

  // ------------------------------------------------- MCP gate (end-to-end)
  const mcp = require('../services/mcp');
  const enterpriseClient = mcp.createClient({
    registry: mcp.registry,
    policy: mcp.policy,
    adapter: mcp.adapter,
    adapters: mcp.adapters,
    platform: held,
    enabled: true
  });
  const exec = await enterpriseClient.call('sentinel.scan', {}, { workspaceId: ws.id, userId: user.id });
  ok(exec.ok === false && exec.error === 'denied' && exec.reason === 'gov_hold',
    'executeCapability gate enforces platform policy deny');
  const execAudit = held.policies.audit.list().filter((e) => e.capability === 'sentinel.scan' && e.decision === 'deny');
  ok(execAudit.length > 0, 'gate denial is recorded by the policy audit');

  // ------------------------------------------------ evaluatePolicy (direct)
  const direct = await platform.evaluatePolicy({ capability: 'sentinel.scan', workspaceId: 'ws-1' });
  ok(direct.allowed === true, 'platform.evaluatePolicy exposes the engine directly');

  console.log(`✓ policy engine (${passed} assertions passed)`);
  console.log('  registry · deny-wins fail-closed evaluator · sentinel governance pack · decision audit · platform + MCP gate enforcement');
  process.exit(0);
})().catch(err => {
  console.error('✗ policy engine test failed:', err);
  process.exit(1);
});

