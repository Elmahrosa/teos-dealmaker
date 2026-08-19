'use strict';

const { createRepos } = require('../../db/repos');

const PRODUCTS = {
  dealmaker: {
    id: 'dealmaker',
    label: 'TEOS DealMaker',
    features: ['missions', 'pipeline', 'deals', 'intelligence', 'billing', 'agents'],
    defaultPlan: 'solo'
  },
  aiengine: {
    id: 'aiengine',
    label: 'TEOS AI Engine',
    features: ['content_generation', 'publishing', 'analytics'],
    defaultPlan: 'solo'
  },
  sentinel: {
    id: 'sentinel',
    label: 'TEOS Sentinel Shield',
    features: ['execution_firewall', 'audit', 'policy_enforcement'],
    defaultPlan: 'solo'
  }
};

const MODES = { DRY: 'dry', LIVE: 'live' };

const PLAN_LIMITS = {
  solo: { missions: 5, seats: 1, agents: 13, products: ['dealmaker'] },
  growth: { missions: 20, seats: 10, agents: 13, products: ['dealmaker', 'aiengine'] },
  corporate: { missions: 100, seats: 25, agents: 13, products: ['dealmaker', 'aiengine', 'sentinel'] },
  founder: { missions: Infinity, seats: Infinity, agents: Infinity, products: ['dealmaker', 'aiengine', 'sentinel'] },
  manual_pilot: { missions: Infinity, seats: Infinity, agents: Infinity, products: ['dealmaker', 'aiengine', 'sentinel'] }
};

function getConfig() {
  return {
    products: PRODUCTS,
    modes: MODES,
    planLimits: PLAN_LIMITS,
    defaultMode: process.env.TEOS_DEFAULT_MODE || MODES.DRY
  };
}

async function getWorkspaceContext(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const workspace = await repos.workspaces.get(workspaceId);
  if (!workspace) return null;

  const subscription = await repos.subscriptions.get(workspaceId);
  const members = await repos.members.list(workspaceId);
  const settings = await repos.settings.getByWorkspace(workspaceId);

  const plan = workspace.plan || 'solo';
  const planLimits = PLAN_LIMITS[plan] || PLAN_LIMITS.solo;
  const product = PRODUCTS.dealmaker;

  return {
    workspace,
    subscription,
    members,
    settings,
    plan,
    planLimits,
    product,
    mode: workspace.dry_mode || process.env.TEOS_DEFAULT_MODE || MODES.DRY,
    isLive: (workspace.dry_mode || process.env.TEOS_DEFAULT_MODE || MODES.DRY) === MODES.LIVE,
    isFounder: plan === 'founder',
    features: product.features,
    memberCount: members.length,
    seatLimit: planLimits.seats,
    missionLimit: planLimits.missions,
    missionsUsed: subscription ? subscription.missions_used : 0,
    missionsRemaining: subscription
      ? (planLimits.missions === Infinity ? Infinity : Math.max(0, planLimits.missions - subscription.missions_used))
      : 0
  };
}

async function setWorkspaceMode(adapter, workspaceId, mode) {
  if (!Object.values(MODES).includes(mode)) {
    throw new Error(`Invalid mode: ${mode}. Must be one of: ${Object.values(MODES).join(', ')}`);
  }

  const repos = createRepos(adapter);
  const workspace = await repos.workspaces.get(workspaceId);
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

  const priorMode = workspace.dry_mode || MODES.DRY;
  await repos.workspaces.update(workspaceId, { dry_mode: mode });

  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'workspace',
    action_type: 'WORKSPACE_MODE_CHANGED',
    details: { from: priorMode, to: mode, workspaceId },
    version: 'v1.2.0'
  });

  return { ok: true, mode, priorMode, workspaceId };
}

async function getWorkspaceMode(adapter, workspaceId) {
  const repos = createRepos(adapter);
  const workspace = await repos.workspaces.get(workspaceId);
  if (!workspace) return null;
  return workspace.dry_mode || MODES.DRY;
}

async function listWorkspaces(adapter, opts) {
  const o = opts || {};
  const repos = createRepos(adapter);
  const all = await repos.workspaces.list();

  let result = all;
  if (o.plan) result = result.filter(w => w.plan === o.plan);
  if (o.status) result = result.filter(w => w.status === o.status);
  if (o.product) {
    const planLimits = PLAN_LIMITS;
    result = result.filter(w => {
      const limits = planLimits[w.plan] || PLAN_LIMITS.solo;
      return limits.products.includes(o.product);
    });
  }

  return result.map(w => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
    plan: w.plan,
    status: w.status,
    mode: w.dry_mode || MODES.DRY,
    createdAt: w.created_at
  }));
}

async function canAccessProduct(adapter, workspaceId, productId) {
  const context = await getWorkspaceContext(adapter, workspaceId);
  if (!context) return false;
  return context.planLimits.products.includes(productId);
}

async function canRunMission(adapter, workspaceId) {
  const context = await getWorkspaceContext(adapter, workspaceId);
  if (!context) return false;
  if (context.isFounder) return true;
  return context.missionsRemaining > 0;
}

async function canAddSeat(adapter, workspaceId) {
  const context = await getWorkspaceContext(adapter, workspaceId);
  if (!context) return false;
  if (context.isFounder) return true;
  return context.memberCount < context.seatLimit;
}

module.exports = {
  PRODUCTS,
  MODES,
  PLAN_LIMITS,
  getConfig,
  getWorkspaceContext,
  setWorkspaceMode,
  getWorkspaceMode,
  listWorkspaces,
  canAccessProduct,
  canRunMission,
  canAddSeat
};
