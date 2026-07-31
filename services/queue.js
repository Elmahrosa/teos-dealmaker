const { createRepos } = require('../db/repos');

const QUEUE_STAGES = [
  { stage: 'incoming', label: 'Incoming Lead' },
  { stage: 'research', label: 'Research' },
  { stage: 'qualification', label: 'Qualification' },
  { stage: 'proposal', label: 'Proposal' },
  { stage: 'negotiation', label: 'Negotiation' },
  { stage: 'closing', label: 'Closing' },
  { stage: 'won', label: 'Won' }
];

function normalizeStage(stage) {
  return QUEUE_STAGES.some(q => q.stage === stage) ? stage : 'incoming';
}

async function enqueueDeal(adapter, workspaceId, companyName) {
  const repos = createRepos(adapter);
  return repos.deals.create({
    workspace_id: workspaceId,
    company_name: companyName,
    stage: 'incoming',
    status: 'open',
    deal_value: null,
    currency: 'USD',
    current_agent: 'orchestrator'
  });
}

async function advanceQueue(adapter, workspaceId, dealId, toStage) {
  const repos = createRepos(adapter);
  const deal = await repos.deals.get(workspaceId, dealId);
  if (!deal) return null;
  const fromStage = normalizeStage(deal.stage);
  const next = normalizeStage(toStage);
  if (fromStage === next) return deal;
  await repos.deals.advanceStage(workspaceId, dealId, next, fromStage);
  if (next === 'won') {
    await repos.deals.update(workspaceId, dealId, { status: 'closed' });
  }
  return repos.deals.get(workspaceId, dealId);
}

async function queueSnapshot(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const deals = await repos.deals.list(workspaceId, {});
  const byStage = {};
  for (const q of QUEUE_STAGES) byStage[q.stage] = 0;
  for (const d of deals) byStage[normalizeStage(d.stage)] += 1;
  return {
    stages: QUEUE_STAGES.map(q => ({ stage: q.stage, label: q.label, count: byStage[q.stage] })),
    total: deals.length
  };
}

async function queueMovements(adapter, workspaceId, limit) {
  const repos = createRepos(adapter);
  const events = await repos.pipeline.listAll(workspaceId, { limit: limit || 10 });
  const deals = await repos.deals.list(workspaceId, {});
  const names = {};
  for (const d of deals) names[d.id] = d.company_name;
  return events.map(e => ({
    deal_id: e.deal_id,
    company: names[e.deal_id] || 'Deal #' + e.deal_id,
    from_stage: e.from_stage || '—',
    to_stage: e.to_stage,
    created_at: e.created_at || null
  }));
}

module.exports = { QUEUE_STAGES, enqueueDeal, advanceQueue, queueSnapshot, queueMovements };
