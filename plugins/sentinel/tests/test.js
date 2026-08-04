const assert = require('assert');
const path = require('path');

(async () => {
  delete process.env.SENTINEL_ENDPOINT;
  delete process.env.MCP_ENDPOINT;
  process.env.MCP_ENABLED = 'true';
  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };

  console.log('\n=== Plugin: sentinel (second official) ===');

  const root = path.join(__dirname, '..', '..', '..');
  const pluginDir = path.join(__dirname, '..');
  const { createPluginManager } = require(path.join(root, 'services', 'plugin-manager'));
  const pm = createPluginManager();

  const manifest = require(path.join(pluginDir, 'manifest.json'));

  // -------------------------------------------------------- platform contract
  ok(pm.validateManifest(manifest).valid === true, 'manifest validates against the platform contract');
  ok(manifest.apiVersion === 1 && manifest.fallback === false, 'manifest pins apiVersion + is not the fallback transport');

  // ----------------------------------------------------------------- register
  const loadRes = pm.loadPlugins();
  ok(loadRes.loaded.includes('sentinel'), 'plugin loads through the platform loader');
  const rec = pm.registry.get('sentinel');
  ok(rec.id === 'sentinel' && rec.server === 'sentinel', 'record carries metadata');
  ok(rec.state === 'healthy', 'plugin initializes to healthy');
  ok(rec.tools.length === 5, 'declares the five sentinel capabilities');
  ok(['sentinel.scan', 'sentinel.audit', 'sentinel.policy.check', 'sentinel.rules.list', 'sentinel.health']
    .every(t => rec.tools.some(tool => tool.toolId === t)), 'capabilities match the intended surface');
  ok(rec.permissions.workspace === true && rec.permissions.memoryRead === true, 'manifest grants merged over defaults');
  ok(rec.schema && Object.keys(rec.schema).length === 5, 'schema entry loaded for every tool');
  ok(typeof rec.audit.write === 'function', 'plugin-side audit writer wired onto the record');
  ok(typeof rec.adapter.call === 'function' && typeof rec.adapter.discover === 'function', 'adapter satisfies the entry contract');
  ok(pm.fallbackAdapter() === pm.registry.get('civic-mixer').adapter, 'civic-mixer stays the fallback; sentinel does not shadow it');

  // ---------------------------------------------------------------- policy
  ok(pm.permissions.check('sentinel.scan', { workspaceId: 'ws-1' }).allowed === true,
    'scan with a workspace is allowed');
  const noWs = pm.permissions.check('sentinel.scan', {});
  ok(noWs.allowed === false && noWs.reason === 'sentinel_workspace_required', 'scan without a workspace is denied');
  ok(pm.permissions.check('sentinel.audit', { workspaceId: 'ws-1' }).allowed === true,
    'audit with a workspace is allowed');
  ok(pm.permissions.check('sentinel.audit', {}).reason === 'sentinel_workspace_required',
    'audit without a workspace is denied');
  ok(pm.permissions.check('sentinel.policy.check', { payload: { toolId: 'slack.postMessage' } }).allowed === true,
    'policy.check with a tool is allowed');
  ok(pm.permissions.check('sentinel.policy.check', { payload: {} }).reason === 'sentinel_tool_required',
    'policy.check without a tool is denied');
  ok(pm.permissions.check('sentinel.rules.list', {}).allowed === true, 'read-only capability has no policy gate');

  // ---------------------------------------------------- adapter (simulated)
  const createAdapter = require(path.join(pluginDir, 'adapter.js'));
  const sim = createAdapter();
  const scan = await sim.call({ toolId: 'sentinel.scan', payload: {}, workspaceId: 'ws-1' });
  ok(scan.ok === true && scan.simulated === true && scan.data.status === 'clear', 'no endpoint -> simulated clear scan');
  ok((await sim.call({ toolId: 'sentinel.audit', payload: {}, workspaceId: 'ws-1' })).data.total === 0,
    'simulated audit trail');
  ok((await sim.call({ toolId: 'sentinel.policy.check', payload: { toolId: 'secrets.read' } })).data.decision === 'no_rule',
    'simulated policy decision');
  ok((await sim.call({ toolId: 'sentinel.rules.list', payload: {} })).data.rules.length === 3,
    'simulated rules list');
  ok((await sim.call({ toolId: 'sentinel.health', payload: {} })).data.status === 'healthy', 'simulated health');
  ok((await sim.health()).status === 'not_configured', 'health reports not_configured without an endpoint');
  ok((await sim.discover()).tools.length === 5, 'discover lists the sentinel tool surface');

  // ------------------------------------------------------ adapter (gateway)
  const sent = [];
  const okTransport = async (url, options) => {
    sent.push({ url, options });
    return {
      ok: true,
      status: 200,
      data: {
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: 'scan complete' }], isError: false }
      }
    };
  };
  const live = createAdapter({ endpoint: 'https://sentinel.test/mcp', apiKey: 's-key', transport: okTransport });
  const liveRes = await live.call({ toolId: 'sentinel.scan', payload: {}, workspaceId: 'ws-1' });
  ok(liveRes.ok === true && liveRes.data === 'scan complete' && liveRes.simulated === false, 'endpoint -> real gateway call');
  const body = JSON.parse(sent[0].options.body);
  ok(body.method === 'tools/call' && body.params.name === 'sentinel.scan', 'JSON-RPC tools/call envelope');
  ok(sent[0].options.headers['Authorization'] === 'Bearer s-key', 'API key attached from config');
  ok(sent[0].url === 'https://sentinel.test/mcp', 'endpoint came from config, not hardcoded');

  // ------------------------------------------------------------ plugin audit
  const audit = require(path.join(pluginDir, 'audit.js'));
  audit.write('SENTINEL_SCAN', 'system', 'success', { workspaceId: 'ws-1' });
  audit.write('SENTINEL_AUDIT', 'system', 'success', { workspaceId: 'ws-2' });
  const trail = audit.list();
  ok(trail.length === 2 && trail[0].event === 'SENTINEL_SCAN', 'plugin audit writer records entries');
  ok(trail[1].meta.workspaceId === 'ws-2', 'plugin audit entries carry metadata');

  // ------------------------------------------------ integration (auto-load)
  const mcp = require(path.join(root, 'services', 'mcp'));
  const singleton = mcp.pluginManager;
  ok(singleton.registry.has('sentinel'), 'plugin auto-loads when the MCP facade is required');
  ok(mcp.pluginStatus('sentinel').enabled === true, 'auto-loaded plugin is enabled');
  ok(mcp.registry.isKnown('sentinel.scan'), 'sentinel tools synced into the MCP catalog');
  ok(mcp.registry.get('sentinel.scan').server === 'sentinel', 'sentinel tools route to the plugin server');
  ok(mcp.adapters.get('sentinel').config().endpoint === '', 'plugin adapter resolves for its server');

  const scanExec = await mcp.execute('sentinel.scan', {}, { workspaceId: 'ws-1' });
  ok(scanExec.ok === true && scanExec.simulated === true && scanExec.reason === 'mcp_not_configured',
    'no endpoint -> client stays simulated (mcp_not_configured)');
  const denied = await mcp.execute('sentinel.scan', {});
  ok(denied.ok === false && denied.error === 'denied' && denied.reason === 'sentinel_workspace_required',
    'policy denial enforced through the MCP facade');

  // ----------------------------------------------------------- isolation
  ok(mcp.adapters.get('github') === singleton.registry.get('civic-mixer').adapter,
    'sentinel does not change the fallback transport');
  ok(pm.discover().filter(p => p.server === 'sentinel').length === 1, 'sentinel owns a distinct server namespace');

  console.log(`✓ sentinel plugin (${passed} assertions passed)`);
  console.log('  manifest contract · register · governance policy · simulated adapter · JSON-RPC gateway · audit writer · auto-load isolation');
  process.exit(0);
})().catch(err => {
  console.error('✗ sentinel plugin test failed:', err);
  process.exit(1);
});
