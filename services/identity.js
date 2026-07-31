const { createRepos } = require('../db/repos');

const AGENT_TYPES = [
  'orchestrator',
  'prospecting',
  'market_intelligence',
  'qualification',
  'outreach',
  'strategist',
  'marketer',
  'sales',
  'negotiator',
  'treasurer',
  'gatekeeper',
  'closing'
];

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addMonths(isoDate, months) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

async function ensureUser(adapter, telegramId, extra) {
  const e = extra || {};
  let user = await adapter.findOne('users', { telegram_id: telegramId });
  if (!user) {
    user = await adapter.insert('users', {
      telegram_id: telegramId,
      email: e.email || null,
      display_name: e.display_name || null
    });
  } else if (e.display_name && user.display_name !== e.display_name) {
    user = await adapter.update('users', { telegram_id: telegramId }, { display_name: e.display_name });
  }
  return user;
}

async function getUserByTelegram(adapter, telegramId) {
  return adapter.findOne('users', { telegram_id: telegramId });
}

async function getWorkspaceForUser(adapter, userId) {
  const member = await adapter.findOne('workspace_members', { user_id: userId });
  if (!member) return null;
  return adapter.findOne('workspaces', { id: member.workspace_id });
}

async function uniqueSlug(adapter, name) {
  const base = slugify(name) || 'workspace';
  const existing = await adapter.find('workspaces', {});
  const taken = new Set(existing.map(w => w.slug));
  let slug = base;
  let n = 2;
  while (taken.has(slug)) {
    slug = `${base}-${n}`;
    n++;
  }
  return slug;
}

async function provisionWorkspace(adapter, workspaceId, lang) {
  const repos = createRepos(adapter);
  for (const agentType of AGENT_TYPES) {
    await repos.agents.create({ workspace_id: workspaceId, agent_type: agentType, status: 'active', provider: null, model: null });
  }
  await repos.settings.create({ workspace_id: workspaceId, lang: lang || 'en', timezone: 'UTC', notifications: 'on', theme: 'system' });
  await repos.audit.add({
    workspace_id: workspaceId,
    agent_name: 'orchestrator',
    action_type: 'WORKSPACE_PROVISIONED',
    details: { agents: AGENT_TYPES.length, version: 'v0.2.0' },
    version: 'v0.2.0'
  });
  return AGENT_TYPES.length;
}

async function onboardWorkspace(adapter, { ownerUserId, companyName, lang, plan }) {
  const repos = createRepos(adapter);
  const slug = await uniqueSlug(adapter, companyName);
  const workspace = await repos.workspaces.create({
    name: companyName,
    slug,
    plan: plan || 'growth',
    status: 'active',
    owner_user_id: ownerUserId
  });

  await repos.members.add({ workspace_id: workspace.id, user_id: ownerUserId, role: 'owner' });

  const startDate = today();
  const renewalDate = addMonths(startDate, 1);
  const subscription = await repos.subscriptions.create({
    workspace_id: workspace.id,
    plan: plan || 'growth',
    status: 'pending',
    cycle: 'monthly',
    start_date: startDate,
    renewal_date: renewalDate,
    provider: 'dodo',
    provider_customer_id: null
  });

  await repos.workspaces.update(workspace.id, { subscription_id: subscription.id });
  await provisionWorkspace(adapter, workspace.id, lang);

  return repos.workspaces.get(workspace.id);
}

async function addMember(adapter, { workspaceId, userId, role = 'operator' }) {
  const repos = createRepos(adapter);
  return repos.members.add({ workspace_id: workspaceId, user_id: userId, role });
}

module.exports = {
  AGENT_TYPES,
  ensureUser,
  getUserByTelegram,
  getWorkspaceForUser,
  uniqueSlug,
  onboardWorkspace,
  provisionWorkspace,
  addMember
};
