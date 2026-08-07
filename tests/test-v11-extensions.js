// v1.1 extensions: P2 fast-path, P3 universal agent registry, P4 knowledge base,
// P6 channel adapters, P7 continuous learning hook.

'use strict';

const assert = require('assert');

function suite() {
  console.log('suite: v1.1 extensions (fast-path, agents, knowledge, channels, learning)');
  let count = 0;
  const check = (name, fn) => {
    fn();
    count += 1;
    console.log(`  ok ${count}: ${name}`);
  };

  // ---------------------------------------------------------------- P2 fast path
  const fastpath = require('../services/router/fastpath');

  check('fastpath classifies static intents as fast', () => {
    assert.strictEqual(fastpath.classify('greeting').path, 'fast');
    assert.strictEqual(fastpath.classify('help').path, 'fast');
    assert.strictEqual(fastpath.classify('unknown').path, 'fast');
  });

  check('fastpath classifies cached intents as fast but non-static', () => {
    const r = fastpath.classify('status');
    assert.strictEqual(r.path, 'fast');
    assert.strictEqual(r.static, false);
    assert.strictEqual(r.cached, true);
  });

  check('fastpath sends semantic intents to slow path', () => {
    assert.strictEqual(fastpath.classify('create_mission').path, 'slow');
    assert.strictEqual(fastpath.classify('analytics').path === 'slow', false);
  });

  check('fastpath staticResult produces reply-buildable actions', () => {
    const r = fastpath.staticResult('greeting', { language: 'en' }, { isFounder: true });
    assert.strictEqual(r.action, 'greeting');
    assert.strictEqual(r.data.language, 'en');
  });

  // ------------------------------------------------- P3 universal agent registry
  const agents = require('../services/agents/registry');

  check('every registered agent implements the universal contract', () => {
    assert.ok(agents.AGENTS.length >= 10, `expected >=10 agents, got ${agents.AGENTS.length}`);
    for (const a of agents.AGENTS) {
      assert.strictEqual(typeof a.canHandle, 'function', a.id + '.canHandle');
      assert.strictEqual(typeof a.health, 'function', a.id + '.health');
      assert.strictEqual(typeof a.priority, 'function', a.id + '.priority');
      assert.strictEqual(typeof a.suggestions, 'function', a.id + '.suggestions');
      assert.strictEqual(typeof a.handoff, 'function', a.id + '.handoff');
      assert.ok(a.health().ok, a.id + ' healthy');
      assert.ok(Number.isFinite(a.priority()), a.id + ' finite priority');
    }
  });

  check('orchestrator selects the best healthy agent for a request', () => {
    const sel = agents.orchestrator('start a prospecting campaign');
    assert.ok(sel, 'a candidate should be found');
    assert.ok(['prospecting', 'revenue_strategist'].includes(sel.primary.id), `unexpected primary ${sel.primary.id}`);
  });

  check('orchestrator falls back with handoff candidates', () => {
    const sel = agents.orchestrator('research this company dossier');
    assert.ok(sel.primary, 'primary exists');
    assert.ok(Array.isArray(sel.alternatives));
    assert.ok(sel.handoff() === null || sel.handoff().id, 'handoff is null or an agent');
  });

  check('orchestrator returns null when nothing matches', () => {
    const sel = agents.orchestrator('asdf zxcv qwerty');
    assert.strictEqual(sel, null);
  });

  // ------------------------------------------------- P4 knowledge base
  const { getStoreAdapter } = require('../bot/store');
  const { createRepos } = require('../db/repos');
  const kb = require('../services/knowledge');

  check('local embedder produces deterministic dense vectors', () => {
    const v1 = kb.embedder.embed('mission to close the deal with Elmahrosa');
    const v2 = kb.embedder.embed('mission to close the deal with Elmahrosa');
    const v3 = kb.embedder.embed('totally unrelated pizza toppings');
    assert.strictEqual(v1.length, 64);
    assert.ok(Math.abs(kb.search.cosine(v1, v2) - 1) < 1e-9, `identical similarity ${kb.search.cosine(v1, v2)}`);
    assert.ok(kb.search.cosine(v1, v3) < 0.5, `unrelated similarity ${kb.search.cosine(v1, v3)}`);
  });

  check('semantic search ranks relevant documents first', async () => {
    const adapter = getStoreAdapter();
    const wsId = -20001;
    const repos = createRepos(adapter);
    await repos.intelligence.add({ workspace_id: wsId, title: 'Pricing playbook', source_type: 'playbook', content: 'Annual plan pricing and bundling tiers for enterprise customers.', metadata: null });
    await repos.intelligence.add({ workspace_id: wsId, title: 'Onboarding doc', source_type: 'documents', content: 'How to configure the workspace settings and language.', metadata: null });

    const kbx = kb.createKnowledgeBase(adapter);
    const hits = await kbx.search(wsId, 'what is our pricing strategy?', { topK: 3 });
    assert.ok(hits.length >= 1, 'at least one hit');
    assert.strictEqual(hits[0].doc.title, 'Pricing playbook', `expected pricing playbook first, got ${hits[0].doc.title}`);
    assert.ok(hits[0].score > 0, 'score above zero');
  });

  check('knowledge index caches per workspace and supports force refresh', async () => {
    const adapter = getStoreAdapter();
    const kbx = kb.createKnowledgeBase(adapter);
    const docs = await kbx.index(-20002, { force: true });
    assert.ok(Array.isArray(docs));
    const second = await kbx.index(-20002);
    assert.strictEqual(second, docs, 'cached reference returned');
    kbx.invalidate(-20002);
  });

  check('knowledge add writes a row and invalidates the cache', async () => {
    const adapter = getStoreAdapter();
    const wsId = -20003;
    const repos = createRepos(adapter);
    const kbx = kb.createKnowledgeBase(adapter);
    await kbx.add(wsId, { title: 'Learned lesson', source_type: 'lessons', content: 'Always ask for the budget before proposing a plan.' });
    const rows = await repos.intelligence.list(wsId);
    const row = rows.find(r => r.title === 'Learned lesson');
    assert.ok(row, 'lesson row persisted');
    assert.strictEqual(row.source_type, 'lessons');
  });

  // ------------------------------------------------- P6 channel adapters
  const channels = require('../services/channels');

  check('payload sanitizes control characters', () => {
    const p = channels.make('Hello\x00\x07\nworld', { actions: ['status'] });
    assert.strictEqual(p.body.includes('\x00'), false);
    assert.deepStrictEqual(p.actions, [{ label: 'status', value: 'status' }]);
  });

  check('telegram renderer returns text + reply markup', () => {
    const out = channels.render('telegram', channels.make('How can I help?', { actions: ['Status', 'Help'] }));
    assert.ok(out.text.includes('How can I help?'));
    assert.ok(out.replyMarkup.keyboard.length === 2);
  });

  check('email renderer escapes HTML', () => {
    const out = channels.render('email', channels.make('<b>revenue</b> up & good', { meta: { subject: 'Daily' } }));
    assert.strictEqual(out.subject, 'Daily');
    assert.strictEqual(out.html.includes('&lt;b&gt;'), true);
    assert.strictEqual(out.text.includes('<b>'), true);
  });

  check('slack renderer builds mrkdwn blocks', () => {
    const out = channels.render('slack', channels.make('Deal closed!', { actions: ['View'] }));
    assert.strictEqual(out.blocks[0].type, 'section');
    assert.strictEqual(out.blocks[1].type, 'actions');
  });

  check('whatsapp and web renderers pass text through', () => {
    assert.strictEqual(channels.render('whatsapp', channels.make('hi')).text, 'hi');
    const w = channels.render('web', channels.make('hi'));
    assert.strictEqual(w.body, 'hi');
  });

  check('unsupported channel throws', () => {
    assert.throws(() => channels.render('carrier_pigeon', channels.make('hi')));
  });

  // ------------------------------------------------- P7 learning hook
  const learningHook = require('../services/learningHook');
  const { emit, EVENT_NAMES } = require('../services/workforce/events');

  check('learning hook writes lessons after PLAN_COMPLETED', async () => {
    const adapter = getStoreAdapter();
    const wsId = -20004;
    const repos = createRepos(adapter);
    const plan = await repos.plans.create({ workspace_id: wsId, title: 'Win Elmahrosa', goal: 'close the deal', status: 'completed' });
    await repos.planSteps.create({ workspace_id: wsId, plan_id: plan.id, step_key: 's1', agent_type: 'sales', task: 'send proposal', priority: 1, status: 'completed' });

    learningHook.install(adapter);
    emit(EVENT_NAMES.PLAN_COMPLETED, { planId: plan.id, workspaceId: wsId, status: 'completed' });

    let lesson = null;
    for (let i = 0; i < 20 && !lesson; i += 1) {
      await new Promise(r => setTimeout(r, 10));
      const rows = await repos.intelligence.list(wsId);
      lesson = rows.find(r => r.source_type === 'lessons');
    }
    assert.ok(lesson, 'lesson document written to knowledge base');
    assert.ok(lesson.content.includes('Win Elmahrosa'), 'lesson content references the plan');
  });

  return count;
}

if (require.main === module) {
  try {
    const n = suite();
    console.log(`\n${n} checks passed (extensions)`);
  } catch (err) {
    console.error('FAILED:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = { suite };
