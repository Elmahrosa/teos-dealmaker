const { createRepos } = require('../../db/repos');
const queue = require('../queue');
const { runAgent } = require('./runner');

async function runPipelineDemo(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const memorySvc = require('../memory');
  const { buildPlaybook } = require('../../agents/strategist');
  const { craftPositioning } = require('../../agents/marketer');
  const { buildTerms } = require('../../agents/negotiator');
  const { draftContract, createCheckout, closeDeal } = require('../../agents/treasurer');
  const { closeDeal: closingAgent } = require('../../agents/closing');

  const mem = await memorySvc.getMemory(adapter, workspaceId);

  const lead = {
    id: 'deal_ws_' + Date.now(),
    company: mem.company_name || 'Control Center Demo',
    contactName: 'Enterprise Operator',
    product: mem.products && mem.products.length ? mem.products[0] : 'TEOS DealMaker Sovereign License',
    classification: 'Hot',
    fitScore: 92,
    budget: 15000,
    competitivePressure: 'low',
    industry: mem.industry || 'Technology',
    currency: 'USD',
    termMonths: 12,
    paymentMethod: 'invoice'
  };
  const targetPrice = 12500;

  const d = await queue.enqueueDeal(adapter, workspaceId, lead.company);
  await queue.advanceQueue(adapter, workspaceId, d.id, 'research');
  await queue.advanceQueue(adapter, workspaceId, d.id, 'qualification');

  const collaborate = (agentType, note) =>
    repos.dealNotes.add({ workspace_id: workspaceId, deal_id: d.id, agent_name: agentType, note });

  const strategy = await runAgent(adapter, workspaceId, 'strategist', async () => {
    const ctx = await memorySvc.getContextFor(adapter, workspaceId, 'strategist');
    const r = buildPlaybook(lead);
    const note = `Playbook: ${r.style}${ctx.competitors && ctx.competitors.length ? ' · beat ' + ctx.competitors.slice(0, 2).join(', ') : ''}`;
    await collaborate('strategist', note);
    return { output: note, cost_cents: 1, data: r };
  }, { deal_id: d.id });
  const marketing = await runAgent(adapter, workspaceId, 'marketer', async () => {
    const r = craftPositioning(lead, strategy.result.data);
    const note = `Positioning: ${r.headline}`;
    await collaborate('marketer', note);
    return { output: note, cost_cents: 1, data: r };
  }, { deal_id: d.id });
  await queue.advanceQueue(adapter, workspaceId, d.id, 'proposal');
  const negotiation = await runAgent(adapter, workspaceId, 'negotiator', async () => {
    const r = buildTerms(lead, targetPrice, lead.budget);
    const note = `Landing $${r.landingPrice} (max discount ${r.maxDiscount}%)`;
    await collaborate('negotiator', note);
    return { output: note, cost_cents: 1, data: r };
  }, { deal_id: d.id });
  await queue.advanceQueue(adapter, workspaceId, d.id, 'negotiation');
  const deal = { ...lead, amount: negotiation.result.data.landingPrice };
  await repos.deals.update(workspaceId, d.id, { deal_value: deal.amount, current_agent: 'treasurer' });
  const treasurer = await runAgent(adapter, workspaceId, 'treasurer', async () => {
    const contract = draftContract(deal);
    const checkout = await createCheckout(deal, contract);
    closeDeal(deal, contract, checkout);
    const note = `Contract ${contract.contractId}${checkout ? ' · ' + checkout.url : ''}`;
    await collaborate('treasurer', note);
    return { output: note, cost_cents: 2, data: { contract, checkout } };
  }, { deal_id: d.id });
  await queue.advanceQueue(adapter, workspaceId, d.id, 'closing');
  const closing = await runAgent(adapter, workspaceId, 'closing', async () => {
    const r = closingAgent({
      id: lead.id,
      company: lead.company,
      amount: deal.amount,
      currency: 'USD',
      contractId: treasurer.result.data.contract.contractId,
      approved: true,
      paymentMethod: 'invoice'
    });
    const note = `Outcome: ${r.status}`;
    await collaborate('closing', note);
    return { output: note, cost_cents: 0, data: r };
  }, { deal_id: d.id });
  const won = closing.result.data.status === 'won';
  if (won) await queue.advanceQueue(adapter, workspaceId, d.id, 'won');

  const notes = await repos.dealNotes.list(workspaceId, d.id);
  const finalDeal = await repos.deals.get(workspaceId, d.id);

  return {
    strategy: strategy.result.data,
    marketing: marketing.result.data,
    negotiation: negotiation.result.data,
    treasurer: treasurer.result.data,
    closing: closing.result.data,
    deal: finalDeal || d,
    notes,
    won,
    runs: [strategy, marketing, negotiation, treasurer, closing]
  };
}

async function dealTimeline(adapter, workspaceId, dealId) {
  const repos = createRepos(adapter);
  const [deal, notes, events] = await Promise.all([
    repos.deals.get(workspaceId, dealId),
    repos.dealNotes.list(workspaceId, dealId),
    repos.pipeline.list(workspaceId, dealId)
  ]);
  if (!deal) return null;
  const noteRows = notes.map(n => ({
    time: n.created_at || null,
    agent_name: n.agent_name,
    kind: 'note',
    text: n.note
  }));
  const eventRows = events.map(e => ({
    time: e.created_at || null,
    agent_name: 'Pipeline',
    kind: 'stage',
    text: `${e.from_stage || '—'} → ${e.to_stage}`
  }));
  return { deal, notes: noteRows, events: eventRows };
}

module.exports = { runPipelineDemo, dealTimeline };
