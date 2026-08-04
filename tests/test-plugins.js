const assert = require('assert');
const path = require('path');
const fs = require('fs');
const audit = require('../utils/auditLogger');

audit.clearVault();

(async () => {
  process.env.MCP_ENABLED = 'true';
  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };

  console.log('\n=== Plugin platform (generic PluginManager + MCP transport) ===');

  const pm = require('../services/plugin-manager').pluginManager;
  const { createPluginManager } = require('../services/plugin-manager');
  const compat = require('../services/plugin-manager/compatibility');
  const perms = require('../services/plugin-manager/permissions');
  const { createBus, EVENT_NAMES } = require('../services/plugin-manager');
  const schema = require('../services/plugin-manager/manifest.schema.json');
  const registry = require('../services/mcp/registry');
  const policy = require('../services/mcp/policy');
  const adapters = require('../services/mcp/adapters');
  const mcp = require('../services/mcp');

  const FIXTURE = path.join(__dirname, 'fixtures', 'plugins');
  const acmeDir = path.join(FIXTURE, 'acme-ping');
  const acmeAdapter = require(path.join(acmeDir, 'adapter.js'));

  const acmeManifest = JSON.parse(fs.readFileSync(path.join(acmeDir, 'manifest.json'), 'utf8'));
  const brokenManifest = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'broken-plugin', 'manifest.json'), 'utf8'));
  const nonconfManifest = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'nonconforming', 'manifest.json'), 'utf8'));

  // ------------------------------------------- manifest schema (machine readable)
  ok(schema.$schema === 'http://json-schema.org/draft-07/schema#', 'manifest schema is draft-07 JSON Schema');
  ok(schema.properties.apiVersion.const === 1, 'schema pins apiVersion to 1 (number)');
  ok(Array.isArray(schema.required) && schema.required.includes('id')
    && schema.required.includes('apiVersion') && schema.required.includes('engine'),
    'schema requires id + apiVersion + engine');
  ok(schema.properties.engine.type === 'string' && schema.properties.permissions.additionalProperties.type === 'boolean',
    'schema declares engine range + boolean permission grants');

  // ------------------------------------------------------- manifest validation
  ok(pm.validateManifest(acmeManifest).valid === true, 'conforming manifest validates');
  ok(mcp.validatePlugin(acmeManifest).valid === true, 'mcp facade forwards validatePlugin');
  const broken = pm.validateManifest(brokenManifest);
  ok(broken.valid === false, 'broken manifest rejected');
  ok(broken.errors.some(e => e.includes('version')), 'broken manifest flags missing version');
  ok(broken.errors.some(e => e.includes('apiVersion')), 'broken manifest flags apiVersion mismatch');
  ok(pm.validateManifest(nonconfManifest).valid === true, 'entry-violating plugin still has a valid manifest');

  // ----------------------------------------------------- version compatibility
  ok(compat.API_VERSION === 1 && pm.API_VERSION === 1, 'contract apiVersion is 1');
  ok(compat.satisfies('1.0.0', '^1.0.0') === true, 'caret range satisfied');
  ok(compat.satisfies('1.0.0', '^2.0.0') === false, 'caret range rejects major bump');
  ok(compat.satisfies('1.0.0', '1.0.0') === true, 'exact range satisfied');
  ok(compat.satisfies('1.0.0', '*') === true, 'wildcard range satisfied');
  ok(compat.checkApiVersion(1) === true && compat.checkApiVersion('1') === true && compat.checkApiVersion('2') === false,
    'apiVersion gate accepts 1 (string or number), rejects anything else');
  ok(compat.checkEngine('^1.0.0', require('../package.json').version) === true,
    'fixture engine range satisfied by the running engine');

  // ----------------------------------------------------------- load + isolation
  const res = mcp.loadPlugins(FIXTURE);
  ok(res.loaded.includes('acme-ping'), 'conforming plugin loaded');
  ok(res.loaded.includes('teal-ping'), 'dependent plugin loaded');
  ok(res.failed.some(f => f.id === 'broken-plugin' && /contract violation/.test(f.error)),
    'manifest-violating plugin isolated as failed');
  ok(res.failed.some(f => f.id === 'nonconforming' && /entry contract/.test(f.error)),
    'entry-violating plugin isolated as failed');
  ok(res.failed.some(f => f.id === 'engine-mismatch' && /engine/.test(f.error)),
    'engine-incompatible plugin isolated as failed');
  ok(acmeAdapter.calls.initialized === 1, 'plugin initialize() ran once at load');
  ok(pm.isEnabled('acme-ping'), 'plugin enabled by default');
  ok(typeof pm.registry.get('acme-ping').adapter.call === 'function', 'record carries the live adapter');

  // ------------------------------------------------ registered record + registry
  const rec = pm.registry.get('acme-ping');
  ok(rec.name === 'Acme Ping' && rec.version === '1.2.3' && rec.server === 'acme', 'record carries manifest metadata');
  ok(registry.isKnown('acme.ping'), 'plugin tool registered into the MCP catalog');
  ok(registry.get('acme.ping').server === 'acme', 'plugin tool routed to its server');
  ok(registry.get('acme.ping').capabilities.includes('ping'), 'plugin tool capabilities registered');
  ok(registry.get('acme.ping').version === '1.2.3', 'plugin tool carries plugin version');
  ok(registry.isKnown('github.createIssue'), 'builtin catalog untouched by plugin load');
  ok(adapters.get('acme').config().endpoint === 'https://acme.test/mcp', 'plugin adapter resolvable for its server');
  ok(pm.transportAdapter('acme').config().endpoint === 'https://acme.test/mcp', 'transport-agnostic adapter lookup');

  // --------------------------------------------------- discover / capabilities
  const listed = pm.discover();
  ok(listed.some(p => p.id === 'acme-ping' && p.enabled === true), 'discover reports enabled state');
  ok(listed.some(p => p.id === 'civic-mixer' && p.enabled === true), 'civic-mixer auto-loads from the default plugins dir');
  ok(listed.some(p => p.id === 'sentinel' && p.enabled === true), 'sentinel auto-loads from the default plugins dir');
  ok(listed.find(p => p.id === 'acme-ping').tools.includes('acme.ping'), 'discover lists plugin tools');
  ok(pm.capabilities().includes('ping') && pm.capabilities().includes('acme'), 'capabilities() unions plugin surface');
  ok(pm.status('acme-ping').id === 'acme-ping' && pm.status('acme-ping').enabled === true, 'status reports lifecycle state');
  ok(pm.status('ghost') === null, 'status of unknown plugin is null');

  // ------------------------------------------------------------ dependencies
  ok(pm.status('teal-ping').enabled === true, 'requires: satisfied dependency leaves plugin enabled');
  ok(pm.status('deps-plugin').enabled === false, 'requires: missing dependency disables plugin');
  ok(/missing_dependency: ghost-lib/.test(pm.status('deps-plugin').lastError),
    'missing dependency recorded as the disable reason');
  ok(res.deps.ok.includes('teal-ping'), 'dependency report lists satisfied plugins');
  ok(res.deps.blocked.some(b => b.id === 'deps-plugin'), 'dependency report lists blocked plugins');

  // -------------------------------------------------------------- idempotency
  const beforeReload = pm.discover().length;
  const again = mcp.loadPlugins(FIXTURE);
  ok(again.loaded.includes('acme-ping'), 'reload is idempotent');
  ok(pm.discover().length === beforeReload, 'reload does not duplicate plugins');
  ok(pm.register(acmeDir).id === 'acme-ping', 'register of loaded plugin returns existing record');
  assert.throws(() => pm.register(FIXTURE), /no manifest\.json/, 'register without a manifest throws');
  ok(acmeAdapter.calls.initialized === 2, 'reload re-initializes the live record without duplicating it');

  // --------------------------------------------------- policy install from plugin
  ok((await policy.approve({ toolId: 'acme.ping', payload: {}, requester: 'tester' })).allowed === true,
    'plugin tool allowed by default');
  const held = await policy.approve({ toolId: 'acme.ping', payload: { halt: true }, requester: 'tester' });
  ok(held.allowed === false && held.reason === 'fixture_hold', 'plugin-owned policy rule enforced');

  // --------------------------------------------------------------- permissions
  const granted = pm.permissions.list('acme-ping');
  ok(granted.includes('network') && granted.includes('outboundHttp') && granted.includes('workspace'),
    'manifest grants merged over platform defaults');
  ok(pm.permissions.has('acme-ping', 'network'), 'has() reflects a granted capability');
  ok(pm.permissions.list('ghost').length === 0, 'permissions of unknown plugin are empty');
  ok(perms.DEFAULT_PERMISSIONS.shell === false && perms.DEFAULT_PERMISSIONS.workspace === true,
    'platform defaults deny everything except the workspace');
  ok(pm.permissions.revoke('acme-ping', 'network').granted === false, 'revoke drops a capability');
  ok(pm.permissions.has('acme-ping', 'network') === false, 'has reflects revocation');
  const permDenied = await mcp.execute('acme.ping', {});
  ok(permDenied.ok === false && permDenied.error === 'denied' && permDenied.reason === 'plugin_permission_denied',
    'revoked capability is denied before any adapter');
  ok(pm.permissions.grant('acme-ping', 'network').granted === true, 'grant restores a capability');
  ok(pm.permissions.has('acme-ping', 'network') === true, 'has reflects grant');
  ok(pm.permissions.revoke('ghost', 'x').ok === false && pm.permissions.revoke('ghost', 'x').reason === 'unknown_plugin',
    'revoke of unknown plugin reports failure');
  ok(pm.permissions.grant('ghost', 'x').ok === false, 'grant of unknown plugin reports failure');

  // ------------------------------------------- client + executeCapability end to end
  const exec = await mcp.execute('acme.ping', {});
  ok(exec.ok === true && exec.data === 'pong:acme.ping' && exec.simulated === false, 'facade.execute routes to the plugin adapter');

  const { createMemoryAdapter } = require('../db/adapter');
  const identity = require('../services/identity');
  const mc = require('../services/mission-controller');
  ok(typeof mc.executeCapability === 'function', 'mission controller exposes executeCapability');
  const adapter = createMemoryAdapter();
  const tg = 779001;
  await identity.ensureUser(adapter, tg, { display_name: 'Plugin Tester' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tg)).id,
    companyName: 'Plugin Co',
    lang: 'en',
    plan: 'growth'
  });
  const missionExec = await mc.executeCapability(adapter, ws.id, 'acme.ping', {});
  ok(missionExec.ok === true && missionExec.data === 'pong:acme.ping', 'mission -> workforce -> plugin adapter end to end');
  const stepExec = await mc.executeCapability(adapter, ws.id, { step_key: 'ping', tool: 'acme.ping', toolInput: {} });
  ok(stepExec.ok === true && stepExec.data === 'pong:acme.ping', 'mission step declaring tool: routes to plugin');
  ok(mcp.listTools({ server: 'acme' }).length === 1, 'facade lists plugin tools');

  // ------------------------------------------------------- lifecycle disable/enable
  ok((await pm.healthCheck('acme-ping')).status === 'healthy', 'healthCheck reports healthy');
  ok(acmeAdapter.calls.health === 1, 'adapter.health() consulted by healthCheck');
  ok(pm.disable('acme-ping').enabled === false, 'disable flips lifecycle state');
  ok(pm.isEnabled('acme-ping') === false, 'isEnabled reflects disable');
  ok(pm.status('acme-ping').enabled === false, 'status reflects disable');
  ok(pm.disable('ghost').ok === false && pm.disable('ghost').reason === 'unknown_plugin',
    'disable of unknown plugin reports failure');
  const denied = await adapters.get('acme').call({ toolId: 'acme.ping', payload: {} });
  ok(denied.ok === false && denied.error === 'plugin_disabled', 'disabled plugin adapter denies execution');
  const disabledExec = await mcp.execute('acme.ping', {});
  ok(disabledExec.ok === false && disabledExec.error === 'plugin_disabled', 'disabled tools return plugin_disabled through the client');
  const disabledStep = await mc.executeCapability(adapter, ws.id, 'acme.ping', {});
  ok(disabledStep.ok === false && disabledStep.error === 'plugin_disabled', 'mission capability call honors plugin disable');
  ok(pm.enable('acme-ping').enabled === true, 'enable flips lifecycle state back');
  ok(pm.status('acme-ping').state === 'healthy', 'enable restores the pre-disable state');
  ok((await adapters.get('acme').call({ toolId: 'acme.ping', payload: {} })).data === 'pong:acme.ping',
    'enabled plugin adapter executes again');
  ok((await mcp.execute('acme.ping', {})).ok === true, 'client honors re-enable');

  // ------------------------------------------------------------------ shutdown
  ok((await pm.shutdown('acme-ping')).ok === true, 'shutdown completes');
  ok(acmeAdapter.calls.shutdowns === 1, 'adapter.shutdown() invoked by the platform');

  // ---------------------------------------------------------------- event hooks
  ok(EVENT_NAMES.includes('mission.started') && EVENT_NAMES.includes('payment.completed')
    && EVENT_NAMES.includes('sentinel.scan.completed') && EVENT_NAMES.includes('capability.executed'),
    'event name registry covers domain lifecycle');
  const bus = createBus();
  let seen = null;
  const off = bus.subscribe('mission.started', (p) => { seen = p; });
  bus.emit('mission.started', { missionId: 7 });
  ok(seen && seen.missionId === 7, 'bus delivers payload to subscriber');
  ok(bus.names().includes('mission.started'), 'bus reports active subscriptions');
  off();
  bus.emit('mission.started', { missionId: 8 });
  ok(seen.missionId === 7, 'unsubscribe stops delivery');
  const threw = bus.subscribe('workspace.created', () => { throw new Error('boom'); });
  const results = bus.emit('workspace.created', {});
  ok(results.length === 1 && results[0].error === 'boom', 'a throwing handler is isolated');
  threw();
  let paymentSeen = 0;
  const off2 = pm.subscribe('payment.completed', () => { paymentSeen += 1; });
  pm.emit('payment.completed', { amount: 100 });
  ok(paymentSeen === 1, 'pluginManager facade exposes subscribe/emit');
  off2();
  pm.emit('payment.completed', { amount: 200 });
  ok(paymentSeen === 1, 'facade unsubscribe works');

  // ---------------------------------------------------- isolated plugin manager
  const isolated = createPluginManager({ pluginsDir: FIXTURE });
  const isoRes = isolated.loadPlugins();
  ok(isoRes.loaded.includes('acme-ping') && isoRes.loaded.includes('teal-ping'), 'isolated instance loads independently');
  ok(isolated.discover().length === 3, 'isolated instance loads fixtures only');
  ok(pm.discover().length > isolated.discover().length, 'singleton adds auto-loaded first-party plugins');

  // ---------------------------------------------------------- facade plugin surface
  ok(typeof mcp.loadPlugins === 'function' && typeof mcp.validatePlugin === 'function', 'facade exposes loadPlugins + validatePlugin');
  ok(typeof mcp.registerPlugin === 'function' && typeof mcp.discoverPlugins === 'function', 'facade exposes registerPlugin + discoverPlugins');
  ok(typeof mcp.enablePlugin === 'function' && typeof mcp.disablePlugin === 'function', 'facade exposes enablePlugin + disablePlugin');
  ok(typeof mcp.pluginCapabilities === 'function' && typeof mcp.isPluginEnabled === 'function', 'facade exposes pluginCapabilities + isPluginEnabled');
  ok(typeof mcp.grantPluginPermission === 'function' && typeof mcp.revokePluginPermission === 'function',
    'facade exposes permission grant/revoke');
  ok(typeof mcp.hasPluginPermission === 'function' && typeof mcp.pluginPermissions === 'function',
    'facade exposes permission query surface');
  ok(typeof pm.transportAdapter === 'function' && typeof pm.healthCheck === 'function' && typeof pm.shutdown === 'function',
    'pluginManager exposes transport lookup + lifecycle ops');

  // ---------------------------------------------------------------- audit trail
  const auditLines = audit.readVault();
  ok(auditLines.some(l => l.action === 'MCP_TOOL_FAIL' && l.details && l.details.reason === 'plugin_disabled'),
    'plugin disable outcome audited');

  // ------------------------------------------------------------ default-dir scan
  const rootScan = pm.loadPlugins();
  ok(Array.isArray(rootScan.loaded) && Array.isArray(rootScan.failed), 'default-dir scan is always safe');

  console.log(`✓ Plugin platform (${passed} assertions passed)`);
  console.log('  manifest contract · apiVersion/engine gates · entry validation · failure isolation · dependency resolution · permissions · lifecycle · events · transport-agnostic facade · mission end-to-end');
  process.exit(0);
})().catch(err => {
  console.error('✗ Plugin platform test failed:', err);
  process.exit(1);
});
