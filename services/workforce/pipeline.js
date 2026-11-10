
const { createRepos } = require('../../db/repos');
const queue = require('../queue');
const { runAgent } = require('./runner');
const emergency = require('../../config/emergency');
const flags = require('../../config/flags');
const { isDRY } = require('../../config/mode');

// DRY mode: run the pure agent logic and return the analysis without touching
// the store (no deal, notes, queue events, agent runs or usage rows) and
// without any external side effect. The caller sees `dry_run: true`.
async function runPipelineDry(adapter, workspaceId, input) {
  const memorySvc = require('../memory');
  const { buildPlaybook } = require('../../agents/strategist');
  const { craftPositioning } = require('../../agents/marketer');
  const { buildTerms } = require('../../agents/negotiator');
  const { draftContract, closeDeal } = require('../../agents/treasurer');
  const { reviewDraft } = require('../../agents/gatekeeper');

  const mem = await memorySvc.getMemory(adapter, workspaceId);
  const lead = {
    id: 'dry_run',
    company: mem.company_name || 'Asset Listing',
    contactName: null,
    product: input.description,
    assetType: input.assetType,
    sourceUrl: input.sourceUrl || null,
    askingPrice: input.askingPrice ?? null,
    sellerTarget: input.sellerTarget ?? null,
    budget: input.buyerBudget ?? null,
    classification: 'Unqualified',
    industry: mem.industry || 'General',
    currency: input.currency || null,
    termMonths: null,
    paymentMethod: null
  };
  const strategy = buildPlaybook(lead);
  const marketing = craftPositioning(lead, strategy);
  const canNegotiate = hasNegotiationInputs(lead);
  const negotiation = canNegotiate ? buildTerms(lead, lead.sellerTarget, lead.budget) : null;
  const deal = { ...lead, amount: lead.askingPrice };
  const contract = draftContract(deal);
  const status = closeDeal(deal, contract);
  const gatekeeper = reviewDraft(
    `Asset proposal: ${lead.product}. Asset type: ${lead.assetType}`,
    'deal:dry_run'
  );
  return {
    ok: true,
    dry_run: true,
    strategy,
    marketing,
    negotiation,
    treasurer: { contract, checkout: null, status },
    gatekeeper,
    closing: { dealId: lead.id, company: lead.company, status: 'awaiting_customer', won: false },
    deal: null,
    notes: [],
    won: false,
    runs: []
  };
}

function hasNegotiationInputs(lead) {
  return Number.isFinite(lead.sellerTarget) && lead.sellerTarget > 0 &&
    Number.isFinite(lead.budget) && lead.budget > 0 && Boolean(lead.currency);
}

async function runPipeline(adapter, workspaceId, input = {}) {
  const repos = createRepos(adapter);

  if (emergency.isEngaged()) {
    return { ok: false, reason: 'emergency_stop' };
  }
  if (!flags.isEnabled('pipeline')) {
    return { ok: false, reason: 'feature_disabled:pipeline' };
  }

  if (!input.assetType || !input.description) {
    return { ok: false, reason: 'missing_asset_details' };
  }

  if (isDRY()) return runPipelineDry(adapter, workspaceId, input);

  const memorySvc = require('../memory');
  const { buildPlaybook } = require('../../agents/strategist');
  const { craftPositioning } = require('../../agents/marketer');
  const { buildTerms } = require('../../agents/negotiator');
  const { draftContract, createCheckout, closeDeal } = require('../../agents/treasurer');
  const { closeDeal: closingAgent } = require('../../agents/closing');

  const mem = await memorySvc.getMemory(adapter, workspaceId);
  const dealId = 'deal_ws_' + Date.now();

  const lead = {
    id: dealId,
    company: mem.company_name || 'Asset Listing',
    contactName: null,
    product: input.description,
    assetType: input.assetType,
    sourceUrl: input.sourceUrl || null,
    askingPrice: input.askingPrice ?? null,
    sellerTarget: input.sellerTarget ?? null,
    budget: input.buyerBudget ?? null,
    classification: 'Unqualified',
    industry: mem.industry || 'General',
    currency: input.currency || null,
    termMonths: null,
    paymentMethod: null
  };

  const d = await queue.enqueueDeal(adapter, workspaceId, lead.company);
  await queue.advanceQueue(adapter, workspaceId, d.id, 'research');
  await queue.advanceQueue(adapter, workspaceId, d.id, 'qualification');

  const collaborate = (agentType, note) =>
    repos.dealNotes.add({
      workspace_id: workspaceId,
      deal_id: d.id,
      agent_name: agentType,
      note
    });

  const strategy = await runAgent(adapter, workspaceId, 'strategist', async () => {
    const r = buildPlaybook(lead);
    const note = `Playbook: ${r.style}`;
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

  let negotiation = null;
  const canNegotiate =
    Number.isFinite(lead.sellerTarget) &&
    lead.sellerTarget > 0 &&
    Number.isFinite(lead.budget) &&
    lead.budget > 0 &&
    Boolean(lead.currency);

  if (canNegotiate) {
    negotiation = await runAgent(adapter, workspaceId, 'negotiator', async () => {
      const r = buildTerms(lead, lead.sellerTarget, lead.budget);
      const note = `Negotiation analysis: ${r.feasible ? 'feasible' : 'outside budget'}; proposed landing ${r.landingPrice} ${lead.currency}`;
      await collaborate('negotiator', note);
      return { output: note, cost_cents: 1, data: r };
    }, { deal_id: d.id });
  } else {
    await collaborate(
      'negotiator',
      'Negotiation not started: verified seller target, buyer budget and currency are required.'
    );
  }

  // Only advance to negotiation when negotiation analysis actually ran.
  // Never advance past it here: closing/won need customer acceptance.
  if (negotiation) await queue.advanceQueue(adapter, workspaceId, d.id, 'negotiation');

  const deal = {
    ...lead,
    amount: lead.askingPrice
  };

  await repos.deals.update(workspaceId, d.id, {
    deal_value: deal.amount,
    current_agent: 'treasurer'
  });

  const treasurer = await runAgent(adapter, workspaceId, 'treasurer', async () => {
    const contract = draftContract(deal);
    const checkout = await createCheckout(deal, contract);
    const status = closeDeal(deal, contract);

    const note = [
      `Asset: ${lead.assetType}`,
      `Description: ${lead.product}`,
      `Asking price: ${lead.askingPrice ?? 'Not provided'} ${lead.currency || ''}`,
      `Contract status: ${contract.status}`,
      `Deal status: ${status.status}`,
      lead.sourceUrl ? `Source: ${lead.sourceUrl}` : 'No source URL supplied'
    ].join(' | ');

    await collaborate('treasurer', note);
    return {
      output: note,
      cost_cents: 2,
      data: { contract, checkout, status }
    };
  }, { deal_id: d.id });

  const gatekeeper = await runAgent(adapter, workspaceId, 'gatekeeper', async () => {
    const { reviewDraft } = require('../../agents/gatekeeper');
    const commercialDraft = [
      `Asset proposal: ${lead.product}`,
      `Asset type: ${lead.assetType}`,
      `Asking price: ${lead.askingPrice ?? 'Unspecified'} ${lead.currency || ''}`,
      negotiation
        ? `Negotiation analysis: ${negotiation.result.data.suggestedTerms}`
        : 'Negotiation pending verified financial inputs.'
    ].join('. ');

    const r = reviewDraft(commercialDraft, `deal:${d.id}`);
    const note = r.decision === 'APPROVE'
      ? 'Proposal passed internal review; customer acceptance is still required.'
      : `Proposal held for founder review: ${(r.reasons || []).join(', ')}`;

    await collaborate('gatekeeper', note);
    return { output: note, cost_cents: 1, data: r };
  }, { deal_id: d.id });

  const closing = await runAgent(adapter, workspaceId, 'closing', async () => {
    const r = closingAgent({
      id: lead.id,
      company: lead.company,
      amount: deal.amount,
      currency: lead.currency,
      contractId: treasurer.result.data.contract.contractId,
      approved: gatekeeper.result.data.decision === 'APPROVE',
      paymentMethod: null,
      customerAcceptance: null,
      paymentEvidence: null
    });

    const note = 'Deal remains awaiting customer acceptance and independently verified payment evidence.';
    await collaborate('closing', note);
    return { output: note, cost_cents: 0, data: r };
  }, { deal_id: d.id });

  // Internal review is not customer acceptance. Never auto-close this deal.
  const won = false;

  const notes = await repos.dealNotes.list(workspaceId, d.id);
  const finalDeal = await repos.deals.get(workspaceId, d.id);

  const runs = [strategy, marketing];
  if (negotiation) runs.push(negotiation);
  runs.push(treasurer, gatekeeper, closing);

  return {
    ok: true,
    strategy: strategy.result.data,
    marketing: marketing.result.data,
    negotiation: negotiation ? negotiation.result.data : null,
    treasurer: treasurer.result.data,
    gatekeeper: gatekeeper.result.data,
    closing: closing.result.data,
    deal: finalDeal || d,
    notes,
    won,
    runs
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

module.exports = { runPipeline, dealTimeline };
