const assert = require('assert');
const audit = require('../utils/auditLogger');

audit.clearVault();

(async () => {
  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };

  console.log('\n=== MCP client layer (Phase 2.5) ===');

  // ------------------------------------------------------------- registry
  const registry = require('../services/mcp/registry');
  ok(registry.isKnown('github.createIssue'), 'known tool resolved');
  ok(!registry.isKnown('nope.notreal'), 'unknown tool rejected');
  ok(registry.get('github.createIssue').server === 'github', 'tool carries server metadata');
  ok(registry.get('github.createIssue').capabilities.includes('issues'), 'tool declares capabilities');
  ok(registry.versionOf('github.createIssue') === '1.0.0', 'tool exposes a version');
  ok(registry.versionOf('nope.notreal') === null, 'unknown tool has no version');
  ok(registry.list().length >= 18, 'catalog exposes enterprise tool surface');
  ok(registry.list({ server: 'github' }).every(t => t.server === 'github'), 'list filters by server');
  ok(registry.list({ capability: 'payments' }).some(t => t.toolId === 'stripe.createCharge'), 'list filters by capability');
  ok(registry.servers().includes('playwright'), 'servers enumerates gateway backends');
  ok(registry.capabilities().includes('slack'), 'capabilities enumerates tool surface');

  const custom = registry.register({
    toolId: 'acme.ping',
    server: 'acme',
    category: 'custom',
    description: 'Test tool',
    capabilities: ['acme']
  });
  ok(custom.toolId === 'acme.ping' && registry.isKnown('acme.ping'), 'register adds a custom tool');
  assert.throws(() => registry.register({ toolId: 'acme.ping' }), 'duplicate registration rejected');
  assert.throws(() => registry.register({}), 'registration without toolId rejected');

  const removed = registry.unregister('acme.ping');
  ok(removed.removed === true && !registry.isKnown('acme.ping'), 'unregister removes a custom tool');
  ok(registry.unregister('acme.ping').removed === false, 'unregister of unknown tool reports failure');
  ok(registry.unregister('github.createIssue').reason === 'builtin_tool', 'builtin tools cannot be unregistered');

  // ---------------------------------------------------------------- policy
  const policy = require('../services/mcp/policy');
  const allowAll = await policy.approve({ toolId: 'github.createIssue', requester: 'tester' });
  ok(allowAll.allowed === true && allowAll.reason === 'policy_allow_all', 'placeholder policy allows by default');
  const off = policy.addRule(req => (req.toolId === 'stripe.createCharge' ? { allowed: false, reason: 'payments_hold' } : null));
  const blocked = await policy.approve({ toolId: 'stripe.createCharge', requester: 'tester' });
  ok(blocked.allowed === false && blocked.reason === 'payments_hold', 'policy rule can deny a tool');
  off();
  ok((await policy.approve({ toolId: 'stripe.createCharge', requester: 'tester' })).allowed === true, 'removed rule no longer blocks');

  policy.setAllowList(['github.createIssue']);
  ok((await policy.approve({ toolId: 'github.createIssue', requester: 'tester' })).allowed === true, 'allow-listed tool passes');
  const notListed = await policy.approve({ toolId: 'slack.postMessage', requester: 'tester' });
  ok(notListed.allowed === false && notListed.reason === 'tool_not_in_allow_list', 'tool outside allow list rejected');
  policy.reset();

  policy.denyTool('slack.postMessage');
  ok((await policy.approve({ toolId: 'slack.postMessage', requester: 'tester' })).reason === 'tool_denied', 'deny list blocks a tool');
  policy.reset();

  policy.allowWorkspaces(['ws-1']);
  ok((await policy.approve({ toolId: 'github.createIssue', workspaceId: 'ws-1', requester: 'tester' })).allowed === true, 'workspace on allow list passes');
  const otherWs = await policy.approve({ toolId: 'github.createIssue', workspaceId: 'ws-2', requester: 'tester' });
  ok(otherWs.allowed === false && otherWs.reason === 'workspace_not_allowed', 'workspace isolation rejects foreign workspace');
  const noWs = await policy.approve({ toolId: 'github.createIssue', requester: 'tester' });
  ok(noWs.allowed === false && noWs.reason === 'workspace_required', 'workspace isolation requires a workspace id');
  policy.reset();

  // ------------------------------------------------------------- adapter
  const civic = require('../services/mcp/adapters/civicMixer');
  const requests = [];
  const okTransport = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      data: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: 'issue #42 created' }],
          isError: false,
          tools: [{ name: 'github.createIssue' }, { name: 'slack.postMessage' }]
        }
      }
    };
  };
  const adapter = civic.createCivicMixerAdapter({ endpoint: 'https://mixer.test/mcp', apiKey: 'k-123', timeoutMs: 500, transport: okTransport });
  ok(adapter.config().endpoint === 'https://mixer.test/mcp', 'adapter reads configured endpoint');
  const res = await adapter.call({ toolId: 'github.createIssue', payload: { title: 'hi' } });
  ok(res.ok === true && res.data === 'issue #42 created' && res.simulated === false, 'adapter returns normalized result');
  const sent = requests[0];
  ok(sent.url === 'https://mixer.test/mcp', 'no hardcoded URL — endpoint from config');
  ok(sent.options.method === 'POST', 'adapter POSTs JSON-RPC');
  ok(sent.options.headers['Authorization'] === 'Bearer k-123', 'adapter attaches API key');
  const body = JSON.parse(sent.options.body);
  ok(body.method === 'tools/call' && body.params.name === 'github.createIssue', 'adapter sends tools/call envelope');
  ok(body.params.arguments.title === 'hi', 'adapter forwards payload as tool arguments');

  const healthRes = await adapter.health();
  ok(healthRes.ok === true && healthRes.status === 'ok', 'adapter health() probes the gateway');
  const discoverRes = await adapter.discover();
  ok(discoverRes.ok === true && discoverRes.tools.includes('slack.postMessage'), 'adapter discover() lists gateway tools');

  const errTransport = async () => ({ ok: false, status: 503, data: { error: { message: 'gateway down' } } });
  const errAdapter = civic.createCivicMixerAdapter({ endpoint: 'https://mixer.test/mcp', transport: errTransport });
  const fail = await errAdapter.call({ toolId: 'github.createIssue', payload: {} });
  ok(fail.ok === false && fail.error === 'http' && fail.message.includes('gateway down'), 'adapter surfaces HTTP errors');
  const down = await errAdapter.health();
  ok(down.ok === false && down.status === 'down', 'adapter health() reports a down gateway');

  const rpcErrTransport = async () => ({ ok: true, status: 200, data: { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'method not found' } } });
  const rpcAdapter = civic.createCivicMixerAdapter({ endpoint: 'https://mixer.test/mcp', transport: rpcErrTransport });
  const rpcFail = await rpcAdapter.call({ toolId: 'github.createIssue', payload: {} });
  ok(rpcFail.ok === false && rpcFail.error === 'rpc', 'adapter surfaces JSON-RPC errors');

  const hangingTransport = (url, options) => new Promise((_, reject) => {
    if (options && options.signal) options.signal.addEventListener('abort', () => reject(new Error('Aborted')));
  });
  const slowAdapter = civic.createCivicMixerAdapter({ endpoint: 'https://mixer.test/mcp', timeoutMs: 25, transport: hangingTransport });
  const timedOut = await slowAdapter.call({ toolId: 'github.createIssue', payload: {} });
  ok(timedOut.ok === false && timedOut.error === 'timeout', 'adapter aborts on configured timeout');

  const envAdapter = civic.createCivicMixerAdapter();
  ok(typeof envAdapter.config().timeoutMs === 'number', 'adapter has sane default timeout');
  ok(envAdapter.config().endpoint === '', 'adapter defaults endpoint to empty (optional)');

  // --------------------------------------------------------------- client
  const { createClient } = require('../services/mcp/client');
  const client = createClient({
    enabled: true,
    registry,
    policy,
    adapter: civic.createCivicMixerAdapter({ endpoint: 'https://mixer.test/mcp', transport: okTransport })
  });
  const callRes = await client.call('github.createIssue', { title: 'from client' }, { requester: 'unit' });
  ok(callRes.ok === true && callRes.simulated === false && callRes.data === 'issue #42 created', 'client.call forwards to gateway');
  ok(callRes.requester === 'unit', 'client passes requester through');
  const execRes = await client.execute('github.createIssue', { title: 'exec' }, { requester: 'unit' });
  ok(execRes.ok === true && execRes.data === 'issue #42 created', 'client.execute is the call surface');
  const unknown = await client.call('nope.notreal', {});
  ok(unknown.ok === false && unknown.error === 'unknown_tool', 'client rejects unknown tools');
  ok(unknown.requester === 'system', 'client defaults requester to system');

  const disabledClient = createClient({ enabled: false, registry, policy, adapter });
  const disabledRes = await disabledClient.call('github.createIssue', {});
  ok(disabledRes.ok === true && disabledRes.simulated === true && disabledRes.reason === 'mcp_disabled', 'disabled client simulates a no-op');
  const disabledHealth = await disabledClient.health();
  ok(disabledHealth.status === 'disabled' && disabledHealth.simulated === true, 'disabled health reports disabled');
  const disabledDiscover = await disabledClient.discover();
  ok(disabledDiscover.simulated === true && Array.isArray(disabledDiscover.tools), 'disabled discover returns local catalog');

  const unconfigured = createClient({ enabled: true, registry, policy, adapter: civic.createCivicMixerAdapter({}) });
  const unconfRes = await unconfigured.call('github.createIssue', {});
  ok(unconfRes.ok === true && unconfRes.simulated === true && unconfRes.reason === 'mcp_not_configured', 'enabled without endpoint stays simulated');
  ok((await unconfigured.health()).status === 'not_configured', 'health reports not_configured without endpoint');
  ok((await unconfigured.discover()).tools.length >= 18, 'discover falls back to local catalog without endpoint');

  const healthyClient = createClient({ enabled: true, registry, policy, adapter: civic.createCivicMixerAdapter({ endpoint: 'https://mixer.test/mcp', transport: okTransport }) });
  ok((await healthyClient.health()).status === 'ok', 'health returns ok when gateway responds');
  ok((await healthyClient.discover()).tools.length === 2, 'discover returns gateway tool names');
  ok(client.listTools({ server: 'github' }).length >= 3, 'client lists discoverable tools');
  ok(client.registerTool({ toolId: 'acme.ping3', server: 'acme', capabilities: [] }).toolId === 'acme.ping3', 'client registers custom tools');
  ok(client.unregisterTool('acme.ping3').removed === true, 'client unregisters custom tools');

  const wsNoList = await client.call('github.createIssue', {}, { requester: 'unit', workspaceId: 'ws-2' });
  ok(wsNoList.ok === true, 'no workspace allow list -> no workspace rejection');
  policy.allowWorkspaces(['ws-1']);
  const wsAllowed = await client.call('github.createIssue', {}, { requester: 'unit', workspaceId: 'ws-1' });
  ok(wsAllowed.ok === true, 'client honors workspace allow list');
  const wsForeign = await client.call('github.createIssue', {}, { requester: 'unit', workspaceId: 'ws-2' });
  ok(wsForeign.ok === false && wsForeign.error === 'denied' && wsForeign.reason === 'workspace_not_allowed', 'client enforces workspace isolation');
  policy.reset();

  // ---------------------------------------------------- adapter selection
  const adapters = require('../services/mcp/adapters');
  const githubCalls = [];
  const fakeGithubAdapter = {
    config: () => ({ endpoint: 'https://github-adapter.test' }),
    call: async req => { githubCalls.push(req.toolId); return { ok: true, data: 'github-adapter', simulated: false }; }
  };
  adapters.register('github', fakeGithubAdapter);
  const selClient = createClient({
    enabled: true,
    registry,
    policy,
    adapter: civic.createCivicMixerAdapter({ endpoint: 'https://mixer.test/mcp', transport: okTransport }),
    adapters
  });
  const viaGithub = await selClient.call('github.createIssue', {});
  const viaSlack = await selClient.call('slack.postMessage', {});
  ok(viaGithub.data === 'github-adapter' && githubCalls[0] === 'github.createIssue', 'github tools route to the github adapter');
  ok(viaSlack.data === 'issue #42 created', 'unregistered servers fall back to the civic mixer adapter');

  // --------------------------------------------------- default facade (env)
  const facade = require('../services/mcp');
  ok(typeof facade.call === 'function' && typeof facade.execute === 'function', 'facade exposes call + execute');
  ok(typeof facade.health === 'function' && typeof facade.discover === 'function', 'facade exposes health + discover');
  ok(typeof facade.listTools === 'function' && typeof facade.unregisterTool === 'function', 'facade exposes listTools + unregisterTool');
  ok(typeof facade.registerAdapter === 'function' && typeof facade.getTool === 'function', 'facade exposes adapter + registry seams');
  ok(facade.isEnabled() === (process.env.MCP_ENABLED === 'true'), 'facade enablement follows MCP_ENABLED');

  console.log(`✓ MCP client layer (${passed} assertions passed)`);
  console.log('  registry · policy allow-list/workspace isolation · civicMixer adapter · client health/discover · adapter selection');
  process.exit(0);
})().catch(err => {
  console.error('✗ MCP client layer test failed:', err);
  process.exit(1);
});

