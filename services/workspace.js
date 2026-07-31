const { createRepos } = require('../db/repos');
const identity = require('./identity');

function subscriptionLabel(status) {
  if (!status) return '—';
  if (status === 'pending') return 'Trialing';
  if (status === 'trial') return 'Trialing';
  if (status === 'active') return 'Active';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

async function getWorkspaceContext(adapter, userId) {
  const user = await identity.getUserByTelegram(adapter, userId);
  if (!user) return null;
  const workspace = await identity.getWorkspaceForUser(adapter, user.id);
  if (!workspace) return null;
  const repos = createRepos(adapter);
  const [members, agents, deals, subscription, settings] = await Promise.all([
    repos.members.list(workspace.id),
    repos.agents.list(workspace.id),
    repos.deals.list(workspace.id, {}),
    repos.subscriptions.get(workspace.id),
    repos.settings.getByWorkspace(workspace.id)
  ]);
  const membership = members.find(m => m.user_id === user.id);
  return {
    user,
    workspace,
    role: membership ? membership.role : 'operator',
    membersCount: members.length,
    agents: {
      total: agents.length,
      active: agents.filter(a => a.status === 'active' || a.status === 'ready').length
    },
    deals: {
      total: deals.length,
      open: deals.filter(d => d.status === 'open').length,
      closed: deals.filter(d => d.status === 'closed' || d.status === 'won').length
    },
    subscription,
    subscriptionLabel: subscriptionLabel(subscription ? subscription.status : null),
    settings
  };
}

async function setWorkspaceLang(adapter, workspaceId, lang) {
  const repos = createRepos(adapter);
  return repos.settings.update(workspaceId, { lang });
}

module.exports = { getWorkspaceContext, setWorkspaceLang, subscriptionLabel };
