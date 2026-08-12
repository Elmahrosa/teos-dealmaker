const assert = require('assert');
const audit = require('../utils/auditLogger');

audit.clearVault();

process.env.MCP_ENABLED = 'true';
process.env.MCP_ENDPOINT = 'https://civic.example.test/mcp';
process.env.MCP_API_KEY = 'mission-key';
process.env.MCP_TIMEOUT = '2000';

const sent = [];
global.fetch = async (url, options) => {
  sent.push({ url, options });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: 'posted to #sales' }], isError: false }
    })
  };
};

(async () => {
  let passed = 0;
  const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };

  console.log('\n=== MCP integration: mission -> workforce -> Civic Mixer ===');

  const { createMemoryAdapter } = require('../db/adapter');
  const identity = require('../services/identity');
  const mc = require('../services/mission-controller');
  const workforce = require('../services/workforce');
  const mcp = require('../services/mcp');

  ok(mcp.isEnabled() === true, 'MCP enabled from environment');
  ok(typeof workforce.runAgent === 'function' && typeof workforce.REGISTRY === 'object', 'workforce public API unchanged (additive only)');
  ok(typeof workforce.executeCapability === 'function', 'workforce gained optional executeCapability');
  ok(typeof mc.executeCapability === 'function', 'mission controller gained executeCapability');

  const adapter = createMemoryAdapter();
  const tg = 777001;
  await identity.ensureUser(adapter, tg, { display_name: 'MCP Tester' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tg)).id,
    companyName: 'Civic Co',
    lang: 'en',
    plan: 'growth'
  });

  const result = await mc.executeCapability(adapter, ws.id, 'slack.postMessage', {
    channel: '#sales',
    text: 'Deal closed'
  });
  ok(result.ok === true, 'mission tool request succeeded');
  ok(result.simulated === false, 'request hit the real gateway transport');
  ok(result.data === 'posted to #sales', 'gateway response returned to mission');
  ok(result.requester === 'workforce', 'request routed through workforce');

  ok(sent.length === 1, 'exactly one gateway call made');
  ok(sent[0].url === 'https://civic.example.test/mcp', 'endpoint came from MCP_ENDPOINT (no hardcoding)');
  ok(sent[0].options.headers['Authorization'] === 'Bearer mission-key', 'API key attached from MCP_API_KEY');
  const body = JSON.parse(sent[0].options.body);
  ok(body.method === 'tools/call' && body.params.name === 'slack.postMessage', 'JSON-RPC tools/call envelope');
  ok(body.params.arguments.channel === '#sales', 'payload forwarded as tool arguments');

  const auditLines = audit.readVault();
  ok(auditLines.some(l => l.action === 'MCP_POLICY_ALLOW'), 'policy decision audited');
  ok(auditLines.some(l => l.action === 'MCP_TOOL_OK'), 'tool outcome audited');

  const unknown = await mc.executeCapability(adapter, ws.id, 'nope.notreal', {});
  ok(unknown.ok === false && unknown.error === 'unknown_tool', 'mission cannot invoke undeclared tools');

  const off = mcp.policy.addRule(req => (req.toolId === 'slack.postMessage' ? { allowed: false, reason: 'comms_hold' } : null));
  const denied = await mc.executeCapability(adapter, ws.id, 'slack.postMessage', {});
  ok(denied.ok === false && denied.error === 'denied' && denied.reason === 'comms_hold', 'policy denial enforced before transport');
  ok(sent.length === 1, 'denied request never reached the gateway');
  off();

  // ---------------------------------------------- mission step tool support
  const stepResult = await mc.executeCapability(adapter, ws.id, {
    step_key: 'post',
    tool: 'slack.postMessage',
    toolInput: { channel: '#general', text: 'Mission step output' }
  });
  ok(stepResult.ok === true && stepResult.data === 'posted to #sales', 'mission step declaring tool: routes through workforce to the gateway');
  ok(sent.length === 2, 'tool step produced a gateway call');
  const stepBody = JSON.parse(sent[1].options.body);
  ok(stepBody.params.name === 'slack.postMessage' && stepBody.params.arguments.channel === '#general', 'tool step forwards toolInput as arguments');

  const noTool = await mc.executeCapability(adapter, ws.id, { step_key: 'plain', task: 'do a thing' });
  ok(noTool.used === false && noTool.reason === 'no_tool_declared', 'step without tool: is unchanged (no-op)');
  ok(noTool.step === 'plain', 'no-op result names the step');
  ok(sent.length === 2, 'plain step made no gateway call');

  const emptyTool = await mc.executeCapability(adapter, ws.id, { step_key: 'empty', tool: '  ' });
  ok(emptyTool.used === false, 'blank tool declaration is treated as no tool');

  console.log(`✓ MCP integration: mission -> workforce -> Civic Mixer (${passed} assertions passed)`);
  console.log('  executeCapability wiring · step tool: · no-tool no-op · policy gate · audit · env config');
  process.exit(0);
})().catch(err => {
  console.error('✗ MCP integration test failed:', err);
  process.exit(1);
});

