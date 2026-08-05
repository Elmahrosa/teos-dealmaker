const assert = require('assert');
const path = require('path');

(async () => {
  delete process.env.CIVIC_MIXER_ENDPOINT;
  delete process.env.MCP_ENDPOINT;
  process.env.MCP_ENABLED = 'true';
  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };

  console.log('\n=== Plugin: civic-mixer (first official) ===');

  const root = path.join(__dirname, '..', '..', '..');
  const pluginDir = path.join(__dirname, '..');
  const { createPluginManager } = require(path.join(root, 'services', 'plugin-manager'));
  const pm = createPluginManager();

  const manifest = require(path.join(pluginDir, 'manifest.json'));

  // -------------------------------------------------------- platform contract
  ok(pm.validateManifest(manifest).valid === true, 'manifest validates against the platform contract');
  ok(manifest.apiVersion === 1 && /^\d+\.\d+\.\d+$/.test(manifest.version), 'manifest pins apiVersion + semver version');
  ok(manifest.engine === '^1.0.0', 'manifest pins an engine range');

  // ----------------------------------------------------------------- register
  const loadRes = pm.loadPlugins();
  ok(loadRes.loaded.includes('civic-mixer'), 'plugin loads through the platform loader');
  const rec = pm.registry.get('civic-mixer');
  ok(rec.id === 'civic-mixer' && rec.server === 'civic-mixer' && rec.fallback === true, 'record carries metadata + fallback flag');
  ok(rec.state === 'healthy', 'plugin initializes to healthy');
  ok(rec.tools.length === 5, 'declares the five civic capabilities');
  ok(['civic.lookup', 'civic.identity.verify', 'civic.vote.create', 'civic.issue.create', 'civic.issue.list']
    .every(t => rec.tools.some(tool => tool.toolId === t)), 'capabilities match the intended surface');
  ok(rec.permissions.network === true && rec.permissions.workspace === true, 'manifest grants merged over defaults');
  ok(rec.schema && Object.keys(rec.schema).length === 5, 'schema entry loaded for every tool');
  ok(typeof rec.adapter.call === 'function' && typeof rec.adapter.health === 'function', 'adapter satisfies the entry contract');

  // ---------------------------------------------------------------- policy
  ok(pm.permissions.check('civic.issue.create', { payload: { title: 'Fix the fountain' } }).allowed === true,
    'issue.create with a title is allowed');
  const noTitle = pm.permissions.check('civic.issue.create', { payload: {} });
  ok(noTitle.allowed === false && noTitle.reason === 'civic_title_required', 'issue.create without a title is denied');
  ok(pm.permissions.check('civic.vote.create', { payload: { ballotId: 'B-1' } }).allowed === true,
    'vote.create with a ballot is allowed');
  const noBallot = pm.permissions.check('civic.vote.create', { payload: {} });
  ok(noBallot.allowed === false && noBallot.reason === 'civic_ballot_required', 'vote.create without a ballot is denied');
  ok(pm.permissions.check('civic.lookup', { payload: { civicId: 'C-1' } }).allowed === true,
    'read-only capability has no policy gate');

  // ---------------------------------------------------- adapter (simulated)
  const createAdapter = require(path.join(pluginDir, 'adapter.js'));
  const sim = createAdapter();
  const simCall = await sim.call({ toolId: 'civic.issue.create', payload: { title: 'x' } });
  ok(simCall.ok === true && simCall.simulated === true && simCall.data.issueId === 'ISSUE-0001', 'no endpoint -> simulated issue');
  ok((await sim.call({ toolId: 'civic.identity.verify', payload: { identityId: 'I-1' } })).data.verified === true,
    'simulated identity verification');
  ok((await sim.health()).status === 'not_configured', 'health reports not_configured without an endpoint');
  ok((await sim.discover()).tools.length === 5, 'discover lists the civic tool surface');

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
        result: { content: [{ type: 'text', text: 'issue opened' }], isError: false }
      }
    };
  };
  const live = createAdapter({ endpoint: 'https://civic-mixer.test/mcp', apiKey: 'cm-key', transport: okTransport });
  const liveRes = await live.call({ toolId: 'civic.issue.create', payload: { title: 't' } });
  ok(liveRes.ok === true && liveRes.data === 'issue opened' && liveRes.simulated === false, 'endpoint -> real gateway call');
  const body = JSON.parse(sent[0].options.body);
  ok(body.method === 'tools/call' && body.params.name === 'civic.issue.create', 'JSON-RPC tools/call envelope');
  ok(body.params.arguments.title === 't', 'payload forwarded as tool arguments');
  ok(sent[0].options.headers['Authorization'] === 'Bearer cm-key', 'API key attached from config');
  ok(sent[0].url === 'https://civic-mixer.test/mcp', 'endpoint came from config, not hardcoded');

  // ------------------------------------------------ integration (auto-load)
  const mcp = require(path.join(root, 'services', 'mcp'));
  const singleton = mcp.pluginManager;
  ok(singleton.registry.has('civic-mixer'), 'plugin auto-loads when the MCP facade is required');
  ok(mcp.pluginStatus('civic-mixer').enabled === true, 'auto-loaded plugin is enabled');
  ok(mcp.isPluginEnabled('civic-mixer') === true, 'facade mirrors plugin state');
  ok(mcp.registry.isKnown('civic.issue.create'), 'civic tools synced into the MCP catalog');
  ok(mcp.registry.get('civic.issue.create').server === 'civic-mixer', 'civic tools route to the plugin server');
  ok(mcp.adapters.get('civic-mixer').config().endpoint === '', 'plugin adapter resolves for its server');
  ok(mcp.adapters.get('github') === singleton.registry.get('civic-mixer').adapter, 'plugin adapter is the transport fallback');

  const issueExec = await mcp.execute('civic.issue.create', { title: 'Test issue' });
  ok(issueExec.ok === true && issueExec.simulated === true && issueExec.reason === 'mcp_not_configured',
    'no endpoint -> client stays simulated (mcp_not_configured)');
  const denied = await mcp.execute('civic.issue.create', {});
  ok(denied.ok === false && denied.error === 'denied' && denied.reason === 'civic_title_required',
    'policy denial enforced through the MCP facade');
  ok(mcp.revokePluginPermission('civic-mixer', 'network').granted === false, 'permission revoke works on the plugin');
  const permDenied = await mcp.execute('civic.issue.create', { title: 'x' });
  ok(permDenied.ok === false && permDenied.reason === 'plugin_permission_denied', 'revoked permission denies before adapter');
  mcp.grantPluginPermission('civic-mixer', 'network');

  console.log(`✓ civic-mixer plugin (${passed} assertions passed)`);
  console.log('  manifest contract · register · governance policy · simulated adapter · JSON-RPC gateway · auto-load as fallback transport');
  process.exit(0);
})().catch(err => {
  console.error('✗ civic-mixer plugin test failed:', err);
  process.exit(1);
});
