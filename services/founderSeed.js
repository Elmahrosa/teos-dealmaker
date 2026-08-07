'use strict';

// Founder self-hosting seed.
//
// Runs idempotently at every boot (bot + server) so the founder's own platform
// workspace is provisioned before anyone logs in:
//   - Founder user (owner of Elmahrosa International, never billed)
//   - Workspace "Elmahrosa International" (slug workspace_founder) on the
//     internal FOUNDER plan, active, owner = Founder, role super_admin
//   - Internal FOUNDER subscription (lifetime, provider 'internal') — the plan
//     is hidden from pricing and can never be purchased or expire
//   - Customer #0: Elmahrosa International (AI Security) as the first deal,
//     used by the first mission as its target customer
//   - First mission "Sell TEOS DealMaker" (status running) with the full
//     13-step AI revenue workflow; it halts at the founder-approval gate when
//     executed and nothing external happens without approval
//
// No-op when TEOS_FOUNDER_TELEGRAM_ID is unset (tests, local DRY, non-founder
// deployments). Safe to call from multiple processes: every step is idempotent
// and duplicate-key races resolve by re-fetching the existing row.

const identity = require('./identity');
const { createRepos, forWorkspace } = require('../db/repos');

const FOUNDER_WORKSPACE_SLUG = 'workspace_founder';
const FOUNDER_WORKSPACE_NAME = 'Elmahrosa International';
const FOUNDER_PLAN = 'founder';
const FOUNDER_ROLE = 'super_admin';

const CUSTOMER_ZERO = {
  company_name: 'Elmahrosa International',
  industry: 'AI Security',
  website: 'https://dealmaker.elmahrosa.org',
  stage: 'active',
  status: 'active'
};

const FIRST_MISSION_TITLE = 'Sell TEOS DealMaker';
const FIRST_MISSION_GOAL = 'Use Elmahrosa as Customer #0 and allow TEOS DealMaker to execute its complete AI Revenue workflow against its own product before public launch.';

// The 13-step AI revenue workflow required for Mission 1. Covers research,
// ICP, prospects, qualification, outreach (email + LinkedIn), proposals,
// meetings, pricing, follow-ups, revenue forecast and the founder-approval
// gate. Every step is executed by the governed workforce; the final step
// requires founder approval before anything is presented or sent.
const FIRST_MISSION_STEPS = [
  { step_key: 'assess', agent_type: 'revenue_strategist', task: 'Assess whether a full AI revenue workflow for Elmahrosa International selling TEOS DealMaker is viable: set success criteria, a cost budget and when to ask for founder approval.' },
  { step_key: 'research', agent_type: 'market_intelligence', task: 'Research TEOS DealMaker and its market: what it does, who it serves, and the competitive landscape for AI revenue workforces.' },
  { step_key: 'icp', agent_type: 'strategist', task: 'Build the ideal customer profile (ICP) for TEOS DealMaker: target industries, company size, buyers and buying triggers.', depends_on: ['research'] },
  { step_key: 'prospects', agent_type: 'prospecting', task: 'Prospect a prioritized list of target accounts that match the TEOS DealMaker ICP.', depends_on: ['icp'] },
  { step_key: 'qualify', agent_type: 'qualification', task: 'Qualify the top TEOS DealMaker prospects: budget, authority, need, timeline and fit.', depends_on: ['prospects'] },
  { step_key: 'outreach_email', agent_type: 'outreach', task: 'Draft the first-wave outreach email sequence for the qualified TEOS DealMaker prospects.', depends_on: ['qualify'] },
  { step_key: 'outreach_linkedin', agent_type: 'outreach', task: 'Draft LinkedIn connection and message sequences for the same qualified prospects.', depends_on: ['qualify'] },
  { step_key: 'proposal', agent_type: 'sales', task: 'Draft the TEOS DealMaker proposal framework: packages, pricing anchors and terms.', depends_on: ['outreach_email', 'outreach_linkedin'] },
  { step_key: 'meetings', agent_type: 'sales', task: 'Propose the meeting cadence and discovery questions for the scheduled prospect calls.', depends_on: ['proposal'] },
  { step_key: 'pricing', agent_type: 'strategist', task: 'Recommend final pricing for the TEOS DealMaker tiers (Solo, Growth, Business, Enterprise) with anchoring rationale.', depends_on: ['proposal'] },
  { step_key: 'followups', agent_type: 'outreach', task: 'Design the follow-up cadence for TEOS DealMaker prospects who do not respond to the first outreach wave.', depends_on: ['meetings'] },
  { step_key: 'forecast', agent_type: 'treasurer', task: 'Produce a revenue forecast for TEOS DealMaker: pipeline value, expected conversion and confidence range.', depends_on: ['followups'] },
  { step_key: 'present', agent_type: 'gatekeeper', task: 'Present the complete TEOS DealMaker revenue workflow, target accounts, outreach, pricing and forecast to the founder. Requires founder approval before presenting.', depends_on: ['forecast'] }
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureFounderWorkspace(adapter) {
  const fid = process.env.TEOS_FOUNDER_TELEGRAM_ID;
  if (!fid) return { seeded: false, reason: 'no_founder_configured' };

  const repos = createRepos(adapter);
  const founder = await identity.ensureUser(adapter, Number(fid), { display_name: 'Founder' });

  let workspace = await adapter.findOne('workspaces', { slug: FOUNDER_WORKSPACE_SLUG });
  if (!workspace) {
    try {
      workspace = await repos.workspaces.create({
        name: FOUNDER_WORKSPACE_NAME,
        slug: FOUNDER_WORKSPACE_SLUG,
        plan: FOUNDER_PLAN,
        status: 'active',
        owner_user_id: founder.id
      });
    } catch (err) {
      // Two boot processes may race on the unique slug — re-fetch the winner.
      workspace = await adapter.findOne('workspaces', { slug: FOUNDER_WORKSPACE_SLUG });
      if (!workspace) throw err;
    }
  }

  const wsId = workspace.id;
  const created = !(await repos.members.get(wsId, founder.id));

  if (created) {
    await repos.members.add({ workspace_id: wsId, user_id: founder.id, role: FOUNDER_ROLE });
    await identity.provisionWorkspace(adapter, wsId, 'en');
    await repos.audit.add({
      workspace_id: wsId,
      agent_name: 'orchestrator',
      action_type: 'FOUNDER_WORKSPACE_SEEDED',
      details: { workspace_slug: FOUNDER_WORKSPACE_SLUG, plan: FOUNDER_PLAN, owner: founder.id },
      version: 'v1.0.0'
    });
  }

  // The FOUNDER subscription is internal and permanent: active, lifetime,
  // provider 'internal'. Re-created if a partial seed left it missing.
  const existingSub = await repos.subscriptions.get(wsId);
  if (!existingSub) {
    await repos.subscriptions.create({
      workspace_id: wsId,
      plan: FOUNDER_PLAN,
      status: 'active',
      cycle: 'lifetime',
      start_date: today(),
      renewal_date: null,
      refund_eligibility: null,
      provider: 'internal',
      provider_customer_id: null
    });
  }

  // Customer #0: Elmahrosa International (AI Security) as the first deal.
  let customer0 = (await repos.deals.list(wsId, {}))
    .find(d => d.company_name === CUSTOMER_ZERO.company_name);
  if (!customer0) {
    customer0 = await repos.deals.create({
      workspace_id: wsId,
      company_name: CUSTOMER_ZERO.company_name,
      stage: CUSTOMER_ZERO.stage,
      status: CUSTOMER_ZERO.status
    });
    await forWorkspace(adapter, wsId).dealNotes.add(
      customer0.id,
      'orchestrator',
      `Customer #0\nIndustry: ${CUSTOMER_ZERO.industry}\nWebsite: ${CUSTOMER_ZERO.website}`
    );
    await forWorkspace(adapter, wsId).memory.set('customer_0', {
      company_name: CUSTOMER_ZERO.company_name,
      industry: CUSTOMER_ZERO.industry,
      website: CUSTOMER_ZERO.website,
      deal_id: customer0.id
    }, 'manual');
    await repos.audit.add({
      workspace_id: wsId,
      deal_id: customer0.id,
      agent_name: 'orchestrator',
      action_type: 'CUSTOMER_ZERO_SEEDED',
      details: { company_name: CUSTOMER_ZERO.company_name },
      version: 'v1.0.0'
    });
  }

  await forWorkspace(adapter, wsId).memory.set('founder_seed', {
    workspace_slug: FOUNDER_WORKSPACE_SLUG,
    workspace_id: wsId,
    customer0_deal_id: customer0.id,
    seeded_at: new Date().toISOString()
  }, 'manual');

  return { seeded: true, created, workspace, customer0 };
}

async function ensureFounderMission(adapter, workspaceId) {
  const repos = forWorkspace(adapter, workspaceId);
  const existing = (await repos.plans.list()).find(p => p.title === FIRST_MISSION_TITLE);
  if (existing) {
    return { created: false, plan: existing };
  }

  const metrics = {
    total_steps: FIRST_MISSION_STEPS.length,
    completed_steps: 0,
    total_cost_cents: 0,
    budget_cents: 800,
    target_customer: CUSTOMER_ZERO.company_name,
    target_market: CUSTOMER_ZERO.industry,
    expected_revenue: 'First revenue deal',
    deadline: '24 hours',
    duration_hours: 24,
    notes: 'Execute the complete AI revenue workflow against the platform itself.'
  };

  const plan = await repos.plans.create({
    title: FIRST_MISSION_TITLE,
    goal: FIRST_MISSION_GOAL,
    status: 'running',
    priority: 'high',
    metrics,
    version: 'v1.0.0'
  });

  for (const s of FIRST_MISSION_STEPS) {
    await repos.planSteps.create({
      plan_id: plan.id,
      step_key: s.step_key,
      agent_type: s.agent_type,
      step_group: s.depends_on ? 'sequential' : null,
      depends_on: s.depends_on || null,
      task: s.task,
      priority: 3
    });
  }

  await repos.audit.add({
    agent_name: 'orchestrator',
    action_type: 'FOUNDER_MISSION_SEEDED',
    details: { title: FIRST_MISSION_TITLE, steps: FIRST_MISSION_STEPS.length, status: 'running' },
    version: 'v1.0.0'
  });

  return { created: true, plan };
}

async function bootstrapFounder(adapter) {
  const fid = process.env.TEOS_FOUNDER_TELEGRAM_ID;
  if (!fid) return { seeded: false, reason: 'no_founder_configured' };

  const a = adapter || require('../bot/store').getStoreAdapter();
  const result = { seeded: true, reason: 'ok' };

  try {
    const ws = await ensureFounderWorkspace(a);
    Object.assign(result, ws);
    if (ws.seeded) {
      try {
        result.mission = await ensureFounderMission(a, ws.workspace.id);
      } catch (err) {
        result.mission = { error: err.message };
      }
    }
  } catch (err) {
    result.seeded = false;
    result.reason = err.message;
  }

  return result;
}

module.exports = {
  FOUNDER_WORKSPACE_SLUG,
  FOUNDER_WORKSPACE_NAME,
  FOUNDER_PLAN,
  FOUNDER_ROLE,
  CUSTOMER_ZERO,
  FIRST_MISSION_TITLE,
  FIRST_MISSION_GOAL,
  FIRST_MISSION_STEPS,
  ensureFounderWorkspace,
  ensureFounderMission,
  bootstrapFounder
};
