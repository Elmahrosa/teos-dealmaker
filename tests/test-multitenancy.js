const { createMemoryAdapter, createRepos, forWorkspace } = require('../db');

console.log('Testing Multi-tenant Persistence Layer...\n');

let ok = true;
function check(label, cond) {
  if (!cond) { ok = false; console.log(`FAIL: ${label}`); }
}

(async () => {
  const adapter = createMemoryAdapter();
  const repos = createRepos(adapter);

  const wsA = repos.workspaces.create({ name: 'Acme Ltd', slug: 'acme', plan: 'growth' });
  const wsB = repos.workspaces.create({ name: 'Zeta Corp', slug: 'zeta', plan: 'corporate' });
  check('workspaces created', wsA.id && wsB.id && wsA.slug === 'acme');

  const userA = repos.users.create({ email: 'owner@acme.com', display_name: 'Ayman' });
  const userB = repos.users.create({ email: 'lead@zeta.com', display_name: 'Layla' });

  repos.members.add({ workspace_id: wsA.id, user_id: userA.id, role: 'owner' });
  repos.members.add({ workspace_id: wsB.id, user_id: userB.id, role: 'admin' });

  check('member role scoped to workspace A', repos.members.get(wsA.id, userA.id).role === 'owner');
  check('user A not a member of workspace B', repos.members.get(wsB.id, userA.id) === null);

  const dealA = repos.deals.create({ workspace_id: wsA.id, company_name: 'Acme Client', stage: 'lead', deal_value: 5000 });
  const dealB = repos.deals.create({ workspace_id: wsB.id, company_name: 'Zeta Client', stage: 'qualified', deal_value: 90000 });

  const listA = repos.deals.list(wsA.id);
  const listB = repos.deals.list(wsB.id);
  check('workspace A sees only its deal', listA.length === 1 && listA[0].company_name === 'Acme Client');
  check('workspace B sees only its deal', listB.length === 1 && listB[0].company_name === 'Zeta Client');
  check('cross-tenant get returns null', repos.deals.get(wsB.id, dealA.id) === null);
  check('cross-tenant update returns null', repos.deals.update(wsB.id, dealA.id, { stage: 'won' }) === null);

  const updated = repos.deals.update(wsA.id, dealA.id, { stage: 'qualified', deal_value: 7500 });
  check('tenant-scoped update applies', updated.stage === 'qualified' && Number(updated.deal_value) === 7500);

  const advanced = await repos.deals.advanceStage(wsA.id, dealA.id, 'proposal');
  check('pipeline stage advance', advanced.stage === 'proposal');
  const eventsA = repos.pipeline.list(wsA.id, dealA.id);
  const eventsB = repos.pipeline.list(wsB.id, dealA.id);
  check('pipeline event recorded for tenant A only', eventsA.length === 1 && eventsB.length === 0);

  repos.audit.add({ workspace_id: wsA.id, agent_name: 'strategist', action_type: 'STRATEGIST_AGENT_PLAYBOOK_STARTED', details: { lead: dealA.id } });
  repos.audit.add({ workspace_id: wsB.id, agent_name: 'closing', action_type: 'CLOSING_AGENT_DEAL_CLOSED', details: { lead: dealB.id } });
  check('audit count scoped', repos.audit.count(wsA.id) === 1 && repos.audit.count(wsB.id) === 1);
  check('audit list isolated', repos.audit.list(wsA.id).length === 1 && repos.audit.list(wsA.id)[0].agent_name === 'strategist');

  const subA = repos.subscriptions.create({ workspace_id: wsA.id, plan: 'growth', status: 'active', cycle: 'annual', renewal_date: '2027-07-01' });
  check('subscription scoped to tenant A', repos.subscriptions.get(wsA.id).id === subA.id && repos.subscriptions.get(wsB.id) === null);

  const runA = repos.agentRuns.start({ workspace_id: wsA.id, agent_name: 'negotiator', provider: 'anthropic', model: 'claude', input: { offer: 9000 } });
  await repos.agentRuns.complete(wsA.id, runA.id, { status: 'completed', duration_ms: 420, cost_cents: 3 });
  check('agent run recorded in tenant A', repos.agentRuns.list(wsA.id).length === 1);
  check('agent run hidden from tenant B', repos.agentRuns.list(wsB.id).length === 0);
  check('cross-tenant complete returns null', await repos.agentRuns.complete(wsB.id, runA.id, { status: 'completed' }) === null);

  repos.usage.record({ workspace_id: wsA.id, provider: 'anthropic', model: 'claude', input_tokens: 500, output_tokens: 200, cost_cents: 10 });
  repos.usage.record({ workspace_id: wsB.id, provider: 'openai', model: 'gpt-4o', input_tokens: 1000, output_tokens: 100, cost_cents: 50 });
  const sumA = await repos.usage.sum(wsA.id);
  check('usage summed per tenant', sumA.cost_cents === 10 && sumA.input_tokens === 500);

  const convA = repos.conversations.create({ workspace_id: wsA.id, user_id: userA.id, title: 'Onboarding' });
  repos.messages.add({ workspace_id: wsA.id, conversation_id: convA.id, role: 'user', content: 'hello' });
  repos.messages.add({ workspace_id: wsA.id, conversation_id: convA.id, role: 'assistant', content: 'hi' });
  check('messages persist per tenant conversation', repos.messages.list(wsA.id, convA.id).length === 2);
  check('conversation list isolated', repos.conversations.list(wsB.id).length === 0);

  const scoped = forWorkspace(adapter, wsB.id);
  const scopedDeal = scoped.deals.create({ company_name: 'Scoped Client', deal_value: 1200 });
  check('scoped repo forces workspace B', scoped.deals.get(scopedDeal.id).workspace_id === wsB.id);
  check('scoped repo never leaks tenant A', scoped.deals.list().length === 2 && repos.deals.list(wsA.id).length === 1);
  check('scoped repo audit filter', scoped.audit.count() === repos.audit.count(wsB.id));

  let threw = false;
  try {
    const backup = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    require('../db').getAdapter();
    if (backup === undefined) delete process.env.DATABASE_URL;
  } catch (_) {
    threw = true;
  }
  check('getAdapter throws without DATABASE_URL', threw);

  console.log(ok ? 'ALL MULTI-TENANCY CHECKS PASS' : 'MULTI-TENANCY CHECKS FAILED');
  if (!ok) process.exit(1);
  console.log('\nIsolation verified across: deals, pipeline events, audit, subscriptions, agent runs, provider usage, conversations, messages, roles.');
})().catch(err => {
  console.error('MULTI-TENANCY TEST ERROR:', err);
  process.exit(1);
});
