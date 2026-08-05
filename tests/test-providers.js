const assert = require('assert');
const { createMemoryAdapter } = require('../db/adapter');
const { createRepos } = require('../db/repos');
const identity = require('../services/identity');
const providers = require('../services/providers');

(async () => {
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  const tg = 6001;
  await identity.ensureUser(adapter, tg, { display_name: 'Provider Owner' });
  const ws = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tg)).id,
    companyName: 'Provider Co',
    lang: 'en',
    plan: 'growth'
  });

  const policy = await providers.getPolicy(adapter, ws.id);
  assert.strictEqual(Object.keys(policy).length, 13, 'policies seeded for 12 agents + intelligence copilot');
  assert.deepStrictEqual(policy.intelligence, { provider: 'openai', model: 'gpt-4o-mini' }, 'intelligence copilot routed cheap');
  assert.deepStrictEqual(policy.prospecting, { provider: 'gemini', model: 'gemini-2.0-flash' }, 'prospector → Gemini Flash');
  assert.deepStrictEqual(policy.market_intelligence, { provider: 'anthropic', model: 'claude-sonnet-4-5' }, 'researcher → Claude Sonnet');
  assert.deepStrictEqual(policy.negotiator, { provider: 'openai', model: 'gpt-5' }, 'negotiator → GPT-5');
  assert.deepStrictEqual(policy.gatekeeper, { provider: 'groq', model: 'llama-3.1-8b-instant' }, 'gatekeeper → Groq fast');

  await providers.ensurePolicies(adapter, ws.id);
  assert.strictEqual((await providers.getPolicy(adapter, ws.id)).prospecting.provider, 'gemini', 'ensurePolicies idempotent');

  assert.strictEqual(providers.PROVIDERS.openai.label, 'OpenAI', 'provider catalog');
  assert.strictEqual(Object.keys(providers.PROVIDERS).length, 8, 'eight providers');
  assert.strictEqual(providers.isConfigured('ollama'), false, 'ollama not enabled by default');
  assert.strictEqual(providers.resolveModel('anthropic', 'claude-opus-4-5'), 'claude-opus-4-5', 'model resolves');
  assert.strictEqual(providers.resolveModel('anthropic', 'nope-model'), 'claude-sonnet-4-5', 'falls back to default model');
  assert.strictEqual(providers.costFromTokens('anthropic', 'claude-opus-4-5', 1000, 1000), 3, 'cost math: (0.005 + 0.025) dollars → 3 cents');

  const route = await providers.resolveRoute(adapter, ws.id, 'prospecting');
  assert.strictEqual(route.provider, 'gemini', 'routes to policy provider');
  assert.strictEqual(route.simulated, true, 'simulated when provider not configured');

  const gen1 = await providers.generate(adapter, ws.id, 'prospecting', 'Find SaaS companies in Cairo with >50 employees');
  assert.strictEqual(gen1.provider, 'gemini', 'generation routed to gemini');
  assert.strictEqual(gen1.model, 'gemini-2.0-flash', 'gemini flash model');
  assert.strictEqual(gen1.simulated, true, 'simulated without key');
  assert.ok(gen1.text.startsWith('[simulated Gemini'), 'simulated output marked');
  assert.ok(gen1.input_tokens > 0 && gen1.output_tokens > 0, 'token estimates present');

  const gen2 = await providers.generate(adapter, ws.id, 'prospecting', 'Find SaaS companies in Cairo with >50 employees');
  assert.strictEqual(gen1.text, gen2.text, 'simulation deterministic for same prompt');

  const usage = await repos.usage.list(ws.id);
  assert.strictEqual(usage.length, 2, 'two usage rows recorded');
  assert.ok(usage.every(u => u.provider === 'gemini' && u.model === 'gemini-2.0-flash'), 'usage carries provider+model');
  assert.ok(usage.every(u => u.created_at), 'usage timestamps present');

  await providers.generate(adapter, ws.id, 'negotiator', 'Set terms for a $12,500 deal');
  const negUsage = (await repos.usage.list(ws.id)).find(u => u.provider === 'openai');
  assert.strictEqual(negUsage.model, 'gpt-5', 'negotiator uses gpt-5 per policy');

  await repos.providerPolicies.set(ws.id, 'prospecting', 'groq', 'llama-3.1-8b-instant');
  const overrideRoute = await providers.resolveRoute(adapter, ws.id, 'prospecting');
  assert.strictEqual(overrideRoute.provider, 'groq', 'workspace override honored');

  await providers.generate(adapter, ws.id, 'prospecting', 'Re-scan the market');
  const groqUsage = (await repos.usage.list(ws.id)).find(u => u.provider === 'groq');
  assert.ok(groqUsage, 'override writes groq usage');
  assert.strictEqual(groqUsage.model, 'llama-3.1-8b-instant', 'override model used');

  const tgB = 6002;
  await identity.ensureUser(adapter, tgB);
  const wsB = await identity.onboardWorkspace(adapter, {
    ownerUserId: (await identity.getUserByTelegram(adapter, tgB)).id,
    companyName: 'Zeta Provider',
    lang: 'en',
    plan: 'solo'
  });
  const policyB = await providers.getPolicy(adapter, wsB.id);
  assert.strictEqual(policyB.prospecting.provider, 'gemini', 'workspace B policy unaffected by A override');
  assert.strictEqual((await repos.usage.list(wsB.id)).length, 0, 'usage isolated per workspace');

  console.log(`\n✓ provider layer + routing (${32} assertions passed)`);
  console.log(`  ${Object.keys(providers.PROVIDERS).length} providers · ${Object.keys(providers.DEFAULT_POLICY).length} policies · simulated ${gen1.simulated} · override → ${overrideRoute.provider}`);
  process.exit(0);
})().catch(err => {
  console.error('✗ provider test failed:', err);
  process.exit(1);
});
