function createRepos(adapter) {
  return {
    workspaces: {
      create({ name, slug, plan = 'free', status = 'active', owner_user_id = null, subscription_id = null }) {
        return adapter.insert('workspaces', { name, slug, plan, status, owner_user_id, subscription_id });
      },
      get(id) {
        return adapter.findOne('workspaces', { id });
      },
      list() {
        return adapter.find('workspaces', {});
      },
      update(id, changes) {
        return adapter.update('workspaces', { id }, changes);
      }
    },

    users: {
      create({ email, display_name = null, telegram_id = null }) {
        return adapter.insert('users', { email, display_name, telegram_id });
      },
      getById(id) {
        return adapter.findOne('users', { id });
      },
      getByEmail(email) {
        return adapter.findOne('users', { email });
      }
    },

    members: {
      add({ workspace_id, user_id, role = 'operator' }) {
        return adapter.insert('workspace_members', { workspace_id, user_id, role });
      },
      get(workspace_id, user_id) {
        return adapter.findOne('workspace_members', { workspace_id, user_id });
      },
      list(workspace_id) {
        return adapter.find('workspace_members', { workspace_id });
      },
      updateRole(workspace_id, user_id, role) {
        return adapter.update('workspace_members', { workspace_id, user_id }, { role });
      },
      remove(workspace_id, user_id) {
        return adapter.delete('workspace_members', { workspace_id, user_id });
      }
    },

    subscriptions: {
      create({ workspace_id, plan, status = 'pending', cycle = 'monthly', start_date = null, renewal_date = null, refund_eligibility = null, provider = 'dodo', provider_customer_id = null }) {
        return adapter.insert('subscriptions', { workspace_id, plan, status, cycle, start_date, renewal_date, refund_eligibility, provider, provider_customer_id });
      },
      get(workspace_id) {
        return adapter.findOne('subscriptions', { workspace_id });
      },
      update(id, changes) {
        return adapter.update('subscriptions', { id }, changes);
      },
      list() {
        return adapter.find('subscriptions', {});
      }
    },

    dodoCustomers: {
      create({ workspace_id, dodo_customer_id, email = null }) {
        return adapter.insert('dodo_customers', { workspace_id, dodo_customer_id, email });
      },
      getByWorkspace(workspace_id) {
        return adapter.findOne('dodo_customers', { workspace_id });
      }
    },

    deals: {
      create({ workspace_id, company_name, stage = 'lead', status = 'open', deal_value = null, currency = 'USD', current_agent = null }) {
        return adapter.insert('deals', { workspace_id, company_name, stage, status, deal_value, currency, current_agent });
      },
      get(workspace_id, id) {
        return adapter.findOne('deals', { workspace_id, id });
      },
      list(workspace_id, opts) {
        const o = opts || {};
        const where = { workspace_id };
        if (o.stage) where.stage = o.stage;
        if (o.status) where.status = o.status;
        return adapter.find('deals', where, {
          orderBy: o.orderBy || 'id',
          order: o.order || 'desc',
          limit: o.limit,
          offset: o.offset
        });
      },
      update(workspace_id, id, changes) {
        return adapter.update('deals', { workspace_id, id }, changes);
      },
      async advanceStage(workspace_id, id, to_stage, from_stage = null) {
        const deal = await adapter.findOne('deals', { workspace_id, id });
        if (!deal) return null;
        await adapter.update('deals', { workspace_id, id }, { stage: to_stage, current_agent: null });
        await adapter.insert('pipeline_events', { workspace_id, deal_id: id, from_stage: from_stage || deal.stage, to_stage });
        return adapter.findOne('deals', { workspace_id, id });
      }
    },

    pipeline: {
      record({ workspace_id, deal_id, to_stage, from_stage = null }) {
        return adapter.insert('pipeline_events', { workspace_id, deal_id, to_stage, from_stage });
      },
      list(workspace_id, deal_id) {
        return adapter.find('pipeline_events', { workspace_id, deal_id }, { orderBy: 'id', order: 'asc' });
      }
    },

    audit: {
      add({ workspace_id = null, deal_id = null, user_id = null, timestamp = null, agent_name, action_type, details = null, version = null }) {
        return adapter.insert('audit_trail', { workspace_id, deal_id, user_id, timestamp, agent_name, action_type, details, version });
      },
      list(workspace_id, opts) {
        const o = opts || {};
        return adapter.find('audit_trail', { workspace_id }, {
          orderBy: o.orderBy || 'timestamp',
          order: o.order || 'desc',
          limit: o.limit,
          offset: o.offset
        });
      },
      count(workspace_id) {
        return adapter.count('audit_trail', { workspace_id });
      }
    },

    conversations: {
      create({ workspace_id, user_id = null, channel = 'telegram', title = null }) {
        return adapter.insert('conversations', { workspace_id, user_id, channel, title });
      },
      list(workspace_id) {
        return adapter.find('conversations', { workspace_id }, { orderBy: 'id', order: 'desc' });
      }
    },

    messages: {
      add({ workspace_id, conversation_id, role, content, tokens = 0 }) {
        return adapter.insert('messages', { workspace_id, conversation_id, role, content, tokens });
      },
      list(workspace_id, conversation_id) {
        return adapter.find('messages', { workspace_id, conversation_id }, { orderBy: 'id', order: 'asc' });
      }
    },

    agentRuns: {
      start({ workspace_id, agent_name, provider = null, model = null, input = null }) {
        return adapter.insert('agent_runs', { workspace_id, agent_name, status: 'running', provider, model, input });
      },
      complete(workspace_id, id, { status = 'completed', output = null, duration_ms = null, cost_cents = 0 }) {
        return adapter.update('agent_runs', { workspace_id, id }, { status, output, duration_ms, cost_cents, completed_at: new Date().toISOString() });
      },
      list(workspace_id) {
        return adapter.find('agent_runs', { workspace_id }, { orderBy: 'started_at', order: 'desc' });
      }
    },

    usage: {
      record({ workspace_id, provider, model, input_tokens = 0, output_tokens = 0, cost_cents = 0 }) {
        return adapter.insert('provider_usage', { workspace_id, provider, model, input_tokens, output_tokens, cost_cents });
      },
      list(workspace_id) {
        return adapter.find('provider_usage', { workspace_id }, { orderBy: 'created_at', order: 'desc' });
      },
      async sum(workspace_id) {
        const rows = await adapter.find('provider_usage', { workspace_id }, {});
        return rows.reduce((acc, r) => ({
          input_tokens: acc.input_tokens + (r.input_tokens || 0),
          output_tokens: acc.output_tokens + (r.output_tokens || 0),
          cost_cents: acc.cost_cents + (r.cost_cents || 0)
        }), { input_tokens: 0, output_tokens: 0, cost_cents: 0 });
      }
    },

    agents: {
      create({ workspace_id, agent_type, status = 'active', provider = null, model = null }) {
        return adapter.insert('agents', { workspace_id, agent_type, status, provider, model });
      },
      getByWorkspace(workspace_id, agent_type) {
        return adapter.findOne('agents', { workspace_id, agent_type });
      },
      list(workspace_id) {
        return adapter.find('agents', { workspace_id }, { orderBy: 'id', order: 'asc' });
      },
      updateStatus(workspace_id, agent_type, status) {
        return adapter.update('agents', { workspace_id, agent_type }, { status });
      }
    },

    settings: {
      create({ workspace_id, lang = 'en', timezone = 'UTC', notifications = 'on', theme = 'system' }) {
        return adapter.insert('workspace_settings', { workspace_id, lang, timezone, notifications, theme });
      },
      getByWorkspace(workspace_id) {
        return adapter.findOne('workspace_settings', { workspace_id });
      },
      update(workspace_id, changes) {
        return adapter.update('workspace_settings', { workspace_id }, changes);
      }
    }
  };
}

function forWorkspace(adapter, workspaceId) {
  const repos = createRepos(adapter);
  return {
    workspaces: repos.workspaces,
    users: repos.users,
    members: {
      add: ({ user_id, role = 'operator' }) => repos.members.add({ workspace_id: workspaceId, user_id, role }),
      get: user_id => repos.members.get(workspaceId, user_id),
      list: () => repos.members.list(workspaceId),
      updateRole: (user_id, role) => repos.members.updateRole(workspaceId, user_id, role),
      remove: user_id => repos.members.remove(workspaceId, user_id)
    },
    subscriptions: {
      create: data => repos.subscriptions.create({ ...data, workspace_id: workspaceId }),
      get: () => repos.subscriptions.get(workspaceId),
      list: () => repos.subscriptions.list()
    },
    dodoCustomers: {
      create: data => repos.dodoCustomers.create({ ...data, workspace_id: workspaceId }),
      get: () => repos.dodoCustomers.getByWorkspace(workspaceId)
    },
    deals: {
      create: data => repos.deals.create({ ...data, workspace_id: workspaceId }),
      get: id => repos.deals.get(workspaceId, id),
      list: opts => repos.deals.list(workspaceId, opts),
      update: (id, changes) => repos.deals.update(workspaceId, id, changes),
      advanceStage: (id, to_stage, from_stage) => repos.deals.advanceStage(workspaceId, id, to_stage, from_stage)
    },
    pipeline: {
      record: data => repos.pipeline.record({ ...data, workspace_id: workspaceId }),
      list: deal_id => repos.pipeline.list(workspaceId, deal_id)
    },
    audit: {
      add: data => repos.audit.add({ ...data, workspace_id: workspaceId }),
      list: opts => repos.audit.list(workspaceId, opts),
      count: () => repos.audit.count(workspaceId)
    },
    conversations: {
      create: data => repos.conversations.create({ ...data, workspace_id: workspaceId }),
      list: () => repos.conversations.list(workspaceId)
    },
    messages: {
      add: data => repos.messages.add({ ...data, workspace_id: workspaceId }),
      list: conversation_id => repos.messages.list(workspaceId, conversation_id)
    },
    agentRuns: {
      start: data => repos.agentRuns.start({ ...data, workspace_id: workspaceId }),
      complete: (id, data) => repos.agentRuns.complete(workspaceId, id, data),
      list: () => repos.agentRuns.list(workspaceId)
    },
    usage: {
      record: data => repos.usage.record({ ...data, workspace_id: workspaceId }),
      list: () => repos.usage.list(workspaceId),
      sum: () => repos.usage.sum(workspaceId)
    },
    agents: {
      create: data => repos.agents.create({ ...data, workspace_id: workspaceId }),
      get: agent_type => repos.agents.getByWorkspace(workspaceId, agent_type),
      list: () => repos.agents.list(workspaceId),
      updateStatus: (agent_type, status) => repos.agents.updateStatus(workspaceId, agent_type, status)
    },
    settings: {
      create: data => repos.settings.create({ ...data, workspace_id: workspaceId }),
      get: () => repos.settings.getByWorkspace(workspaceId),
      update: changes => repos.settings.update(workspaceId, changes)
    }
  };
}

module.exports = { createRepos, forWorkspace };
