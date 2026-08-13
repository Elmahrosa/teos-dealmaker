function createRepos(adapter) {
  return {
    workspaces: {
      create({ name, slug, plan = 'solo', status = 'active', owner_user_id = null, subscription_id = null }) {
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
      create(userData) {
        return adapter.insert('users', userData);
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
      create({ workspace_id, plan, status = 'pending', cycle = 'monthly', start_date = null, renewal_date = null, refund_eligibility = null, provider = 'dodo', provider_customer_id = null, missions_used = 0 }) {
        return adapter.insert('subscriptions', { workspace_id, plan, status, cycle, start_date, renewal_date, refund_eligibility, provider, provider_customer_id, missions_used });
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
      },
      listAll(workspace_id, opts) {
        const o = opts || {};
        return adapter.find('pipeline_events', { workspace_id }, {
          orderBy: 'id',
          order: o.order || 'desc',
          limit: o.limit
        });
      }
    },

    providerPolicies: {
      async set(workspace_id, agent_type, provider, model) {
        const updated = await adapter.update('provider_policies', { workspace_id, agent_type }, { provider, model });
        return updated || adapter.insert('provider_policies', { workspace_id, agent_type, provider, model });
      },
      get(workspace_id, agent_type) {
        return adapter.findOne('provider_policies', { workspace_id, agent_type });
      },
      list(workspace_id) {
        return adapter.find('provider_policies', { workspace_id });
      },
      remove(workspace_id, agent_type) {
        return adapter.delete('provider_policies', { workspace_id, agent_type });
      }
    },

    audit: {
      add({ workspace_id = null, deal_id = null, user_id = null, timestamp = null, agent_name, action_type, details = null, version = null }) {
        return adapter.insert('audit_trail', { workspace_id, deal_id, user_id, timestamp, agent_name, action_type, details, version });
      },
      list(workspace_id, opts) {
        const o = opts || {};
        const where = workspace_id !== undefined && workspace_id !== null ? { workspace_id } : {};
        return adapter.find('audit_trail', where, {
          orderBy: o.orderBy || 'timestamp',
          order: o.order || 'desc',
          limit: o.limit,
          offset: o.offset
        });
      },
      count(workspace_id) {
        const where = workspace_id !== undefined && workspace_id !== null ? { workspace_id } : {};
        return adapter.count('audit_trail', where);
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
      start({ workspace_id, deal_id = null, plan_id = null, agent_name, provider = null, model = null, input = null }) {
        return adapter.insert('agent_runs', { workspace_id, deal_id, plan_id, agent_name, status: 'running', provider, model, input, started_at: new Date().toISOString() });
      },
      complete(workspace_id, id, { status = 'completed', output = null, duration_ms = null, cost_cents = 0, provider = null, model = null }) {
        return adapter.update('agent_runs', { workspace_id, id }, { status, output, duration_ms, cost_cents, provider, model, completed_at: new Date().toISOString() });
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
      update(workspace_id, agent_type, changes) {
        return adapter.update('agents', { workspace_id, agent_type }, changes);
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
    },

    memory: {
      async upsert(workspace_id, key, value, source = 'manual') {
        const existing = await adapter.findOne('workspace_memory', { workspace_id, key });
        if (existing) {
          return adapter.update('workspace_memory', { workspace_id, key }, { value, source });
        }
        return adapter.insert('workspace_memory', { workspace_id, key, value, source });
      },
      get(workspace_id, key) {
        return adapter.findOne('workspace_memory', { workspace_id, key });
      },
      list(workspace_id) {
        return adapter.find('workspace_memory', { workspace_id });
      },
      remove(workspace_id, key) {
        return adapter.delete('workspace_memory', { workspace_id, key });
      }
    },

    dealNotes: {
      add({ workspace_id, deal_id, agent_name, note }) {
        return adapter.insert('deal_notes', { workspace_id, deal_id, agent_name, note });
      },
      list(workspace_id, deal_id) {
        return adapter.find('deal_notes', { workspace_id, deal_id }, { orderBy: 'id', order: 'asc' });
      }
    },

    intelligence: {
      add({ workspace_id, title, source_type, content, metadata = null }) {
        return adapter.insert('knowledge_documents', { workspace_id, title, source_type, content, metadata });
      },
      get(workspace_id, id) {
        return adapter.findOne('knowledge_documents', { workspace_id, id });
      },
      list(workspace_id, source_type = null) {
        const where = { workspace_id };
        if (source_type) where.source_type = source_type;
        return adapter.find('knowledge_documents', where, { orderBy: 'id', order: 'desc' });
      },
      update(workspace_id, id, changes) {
        return adapter.update('knowledge_documents', { workspace_id, id }, changes);
      },
      remove(workspace_id, id) {
        return adapter.delete('knowledge_documents', { workspace_id, id });
      }
    },

    deal_scenarios: {
      add({ workspace_id, deal_id, name, description = null, scenario_type = null, parameters = null }) {
        return adapter.insert('deal_scenarios', { workspace_id, deal_id, name, description, scenario_type, parameters });
      },
      get(workspace_id, id) {
        return adapter.findOne('deal_scenarios', { workspace_id, id });
      },
      list(workspace_id, deal_id) {
        return adapter.find('deal_scenarios', { workspace_id, deal_id }, { orderBy: 'id', order: 'asc' });
      },
      update(workspace_id, id, changes) {
        return adapter.update('deal_scenarios', { workspace_id, id }, changes);
      },
      remove(workspace_id, id) {
        return adapter.delete('deal_scenarios', { workspace_id, id });
      }
    },

    simulation_runs: {
      add({ workspace_id, deal_scenario_id, status = 'pending', started_at = null, completed_at = null, duration_ms = null, cost_cents = 0, results = null }) {
        return adapter.insert('simulation_runs', { workspace_id, deal_scenario_id, status, started_at, completed_at, duration_ms, cost_cents, results });
      },
      get(workspace_id, id) {
        return adapter.findOne('simulation_runs', { workspace_id, id });
      },
      list(workspace_id, deal_scenario_id) {
        return adapter.find('simulation_runs', { workspace_id, deal_scenario_id }, { orderBy: 'id', order: 'desc' });
      },
      update(workspace_id, id, changes) {
        return adapter.update('simulation_runs', { workspace_id, id }, changes);
      },
      remove(workspace_id, id) {
        return adapter.delete('simulation_runs', { workspace_id, id });
      },
      complete(workspace_id, id, results, duration_ms, cost_cents) {
        return adapter.update('simulation_runs', { workspace_id, id }, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          duration_ms,
          cost_cents,
          results
        });
      }
    },

    integrations: {
      async upsert(workspace_id, connector_id, changes) {
        const existing = await adapter.findOne('integration_connections', { workspace_id, connector_id });
        if (existing) {
          return adapter.update('integration_connections', { workspace_id, connector_id }, changes);
        }
        return adapter.insert('integration_connections', { workspace_id, connector_id, status: 'enabled', ...changes });
      },
      get(workspace_id, connector_id) {
        return adapter.findOne('integration_connections', { workspace_id, connector_id });
      },
      list(workspace_id) {
        return adapter.find('integration_connections', { workspace_id }, { orderBy: 'connector_id', order: 'asc' });
      },
      remove(workspace_id, connector_id) {
        return adapter.delete('integration_connections', { workspace_id, connector_id });
      }
    },

    // Mission intakes: the one-shot customer funnel. Each intake is stored as
    // the mission context (title, objective, and the raw answers) with an
    // explicit status. Contact is only present when the customer provided it.
    intakes: {
      create(payload) {
        return adapter.insert('mission_intakes', payload);
      },
      get(id) {
        return adapter.findOne('mission_intakes', { id });
      },
      list() {
        return adapter.find('mission_intakes', {});
      }
    },
    plans: {
      create({ workspace_id, title, goal, status = 'planned', priority = 'normal', metrics = null, version = null, archived_at = null, is_protected = false }) {
        return adapter.insert('plans', { workspace_id, title, goal, status, priority, metrics, version, archived_at, is_protected });
      },
      get(workspace_id, id) {
        return adapter.findOne('plans', { workspace_id, id });
      },
      list(workspace_id) {
        const where = workspace_id !== undefined && workspace_id !== null ? { workspace_id } : {};
        return adapter.find('plans', where, { orderBy: 'id', order: 'desc' });
      },
      update(workspace_id, id, changes) {
        return adapter.update('plans', { workspace_id, id }, changes);
      }
    },
    planSteps: {
      create({ workspace_id, plan_id, step_key, agent_type, step_group = null, depends_on = null, task, priority = 3, provider = null, model = null }) {
        return adapter.insert('plan_steps', { workspace_id, plan_id, step_key, agent_type, step_group, depends_on, task, priority, provider, model, status: 'pending', retries: 0, attempt: 0 });
      },
      get(workspace_id, id) {
        return adapter.findOne('plan_steps', { workspace_id, id });
      },
      list(workspace_id, plan_id) {
        return adapter.find('plan_steps', { workspace_id, plan_id }, { orderBy: 'id', order: 'asc' });
      },
      update(workspace_id, id, changes) {
        return adapter.update('plan_steps', { workspace_id, id }, changes);
      }
    },
    approvals: {
      create({ workspace_id, plan_id = null, step_id = null, agent_type, reason }) {
        return adapter.insert('approval_requests', { workspace_id, plan_id, step_id, agent_type, reason, status: 'pending' });
      },
      get(workspace_id, id) {
        return adapter.findOne('approval_requests', { workspace_id, id });
      },
      list(workspace_id, status = null) {
        return adapter.find('approval_requests', { workspace_id, ...(status ? { status } : {}) }, { orderBy: 'id', order: 'desc' });
      },
      update(workspace_id, id, changes) {
        return adapter.update('approval_requests', { workspace_id, id }, changes);
      }
    },

    outboundEmails: {
      create({ workspace_id, to_email, from_email, subject, body, status = 'DRAFT', campaign = null }) {
        return adapter.insert('outbound_emails', { workspace_id, to_email, from_email, subject, body, status, campaign });
      },
      get(workspace_id, id) {
        return adapter.findOne('outbound_emails', { workspace_id, id });
      },
      list(workspace_id, opts) {
        const o = opts || {};
        const where = { workspace_id };
        if (o.status) where.status = o.status;
        return adapter.find('outbound_emails', where, { orderBy: 'id', order: 'desc', limit: o.limit });
      },
      listAll(limit) {
        return adapter.find('outbound_emails', {}, { orderBy: 'id', order: 'desc', limit });
      },
      update(workspace_id, id, changes) {
        return adapter.update('outbound_emails', { workspace_id, id }, changes);
      }
    },

    outboundService: {
      async ensure() {
        const existing = await adapter.findOne('outbound_service_state', { service: 'outbound' });
        if (existing) return existing;
        return adapter.insert('outbound_service_state', { service: 'outbound', state: 'PAUSED' });
      },
      get() {
        return adapter.findOne('outbound_service_state', { service: 'outbound' });
      },
      set(state, meta = {}) {
        return adapter.update('outbound_service_state', { service: 'outbound' }, Object.assign({ state, updated_at: new Date().toISOString() }, meta));
      },
      patch(changes) {
        return adapter.update('outbound_service_state', { service: 'outbound' }, Object.assign({ updated_at: new Date().toISOString() }, changes));
      }
    },

    outboundJobs: {
      enqueue(data) {
        return adapter.insert('outbound_jobs', data);
      },
      get(id) {
        return adapter.findOne('outbound_jobs', { id });
      },
      getByIdempotencyKey(key) {
        return adapter.findOne('outbound_jobs', { idempotency_key: key });
      },
      getByProviderMessageId(pid) {
        return adapter.findOne('outbound_jobs', { provider_message_id: pid });
      },
      list(workspace_id, opts) {
        const o = opts || {};
        const where = { workspace_id };
        if (o.status) where.status = o.status;
        return adapter.find('outbound_jobs', where, { orderBy: 'id', order: o.order || 'desc', limit: o.limit });
      },
      update(id, changes) {
        return adapter.update('outbound_jobs', { id }, changes);
      },
      claimIfQueued(id, changes) {
        return adapter.update('outbound_jobs', { id, status: 'QUEUED' }, changes);
      },
      due(limit) {
        return adapter.find('outbound_jobs', { status: 'QUEUED' }, { orderBy: 'id', order: 'asc', limit });
      },
      listRecent(limit) {
        return adapter.find('outbound_jobs', {}, { orderBy: 'id', order: 'desc', limit: limit || 50 });
      },
      staleProcessing(limit) {
        return adapter.find('outbound_jobs', { status: 'PROCESSING' }, { orderBy: 'id', order: 'asc', limit });
      },
      countByStatus(status) {
        return adapter.count('outbound_jobs', { status });
      },
      async countByStatusIn(statuses) {
        const rows = await adapter.find('outbound_jobs', {}, { limit: 10000 });
        return rows.filter(j => statuses.includes(j.status)).length;
      },
      async countSentSince(since) {
        const rows = await adapter.find('outbound_jobs', {}, { limit: 10000 });
        return rows.filter(j => ['SENT', 'PROVIDER_CONFIRMED'].includes(j.status) && j.sent_at && String(j.sent_at) >= String(since)).length;
      },
      async countSentToRecipientSince(recipient, since) {
        const rows = await adapter.find('outbound_jobs', {}, { limit: 10000 });
        return rows.filter(j => j.recipient && String(j.recipient).toLowerCase() === String(recipient).toLowerCase()
          && ['SENT', 'PROVIDER_CONFIRMED'].includes(j.status)
          && j.sent_at && String(j.sent_at) >= String(since)).length;
      },
      async cancelQueued(reason, _by) {
        const rows = await adapter.find('outbound_jobs', { status: 'QUEUED' }, {});
        for (const row of rows) {
          await adapter.update('outbound_jobs', { id: row.id }, {
            status: 'CANCELLED',
            failure_reason: reason,
            updated_at: new Date().toISOString()
          });
        }
        return rows.length;
      }
    },

    emailSuppressions: {
      async _active(email) {
        const rows = await adapter.find('email_suppressions', { email: String(email).toLowerCase() }, {});
        return rows.find(r => !r.cleared_at) || null;
      },
      async add({ workspace_id, email, reason, source_event = null, source_job_id = null }) {
        const existing = await this._active(email);
        if (existing) return existing;
        return adapter.insert('email_suppressions', {
          workspace_id,
          email: String(email).toLowerCase(),
          reason,
          source_event,
          source_job_id
        });
      },
      async isSuppressed(email) {
        return Boolean(await this._active(email));
      },
      list() {
        return adapter.find('email_suppressions', {}, { orderBy: 'id', order: 'desc' });
      },
      async clear(email, by) {
        const row = await this._active(email);
        if (!row) return null;
        return adapter.update('email_suppressions', { id: row.id }, {
          cleared_at: new Date().toISOString(),
          cleared_by: by || 'founder'
        });
      }
    },

    resendEvents: {
      add(data) {
        return adapter.insert('resend_events', data);
      },
      getByEventId(eventId) {
        return adapter.findOne('resend_events', { event_id: eventId });
      }
    },

    prospects: {
      create(data) {
        return adapter.insert('prospects', data);
      },
      get(id) {
        return adapter.findOne('prospects', { id: Number(id) });
      },
      list(opts) {
        const o = opts || {};
        return adapter.find('prospects', o.where || {}, { orderBy: o.orderBy || 'id', order: o.order || 'desc', limit: o.limit });
      },
      listAll(opts) {
        const o = opts || {};
        return adapter.find('prospects', {}, { orderBy: o.orderBy || 'score', order: o.order || 'desc', limit: o.limit });
      },
      update(id, changes) {
        return adapter.update('prospects', { id: Number(id) }, changes);
      },
      count(where) {
        return adapter.count('prospects', where || {});
      }
    },

    founderReports: {
      create(data) {
        return adapter.insert('founder_reports', data);
      },
      get(reportId) {
        return adapter.findOne('founder_reports', { report_id: reportId });
      },
      getByWindow(windowEnd) {
        return adapter.findOne('founder_reports', { window_end: windowEnd });
      },
      update(reportId, changes) {
        return adapter.update('founder_reports', { report_id: reportId }, changes);
      },
      list(opts) {
        const o = opts || {};
        return adapter.find('founder_reports', {}, { orderBy: o.orderBy || 'window_end', order: o.order || 'desc', limit: o.limit });
      }
    },

    revenueOps: {
      get(key) {
        return adapter.findOne('revenue_ops_state', { key });
      },
      set(key, value, payload) {
        const existing = adapter.findOne('revenue_ops_state', { key });
        const row = {
          key,
          value: value == null ? null : String(value),
          payload: payload || null,
          heartbeat_at: new Date().toISOString()
        };
        if (existing) return adapter.update('revenue_ops_state', { key }, row);
        return adapter.insert('revenue_ops_state', row);
      },
      touch(key, value) {
        return this.set(key, value == null ? null : String(value));
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
      list: deal_id => repos.pipeline.list(workspaceId, deal_id),
      listAll: opts => repos.pipeline.listAll(workspaceId, opts)
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
      update: (agent_type, changes) => repos.agents.update(workspaceId, agent_type, changes),
      updateStatus: (agent_type, status) => repos.agents.updateStatus(workspaceId, agent_type, status)
    },
    settings: {
      create: data => repos.settings.create({ ...data, workspace_id: workspaceId }),
      get: () => repos.settings.getByWorkspace(workspaceId),
      update: changes => repos.settings.update(workspaceId, changes)
    },
    memory: {
      set: (key, value, source) => repos.memory.upsert(workspaceId, key, value, source),
      get: key => repos.memory.get(workspaceId, key),
      list: () => repos.memory.list(workspaceId),
      remove: key => repos.memory.remove(workspaceId, key)
    },
    dealNotes: {
      add: (deal_id, agent_name, note) => repos.dealNotes.add({ workspace_id: workspaceId, deal_id, agent_name, note }),
      list: deal_id => repos.dealNotes.list(workspaceId, deal_id)
    },
    providerPolicies: {
      set: (agent_type, provider, model) => repos.providerPolicies.set(workspaceId, agent_type, provider, model),
      get: agent_type => repos.providerPolicies.get(workspaceId, agent_type),
      list: () => repos.providerPolicies.list(workspaceId),
      remove: agent_type => repos.providerPolicies.remove(workspaceId, agent_type)
    },
    intelligence: {
      add: data => repos.intelligence.add({ ...data, workspace_id: workspaceId }),
      get: id => repos.intelligence.get(workspaceId, id),
      list: source_type => repos.intelligence.list(workspaceId, source_type),
      update: (id, changes) => repos.intelligence.update(workspaceId, id, changes),
      remove: id => repos.intelligence.remove(workspaceId, id)
    },
    dealScenarios: {
      add: data => repos.deal_scenarios.add({ ...data, workspace_id: workspaceId }),
      get: id => repos.deal_scenarios.get(workspaceId, id),
      list: (workspaceId, dealId) => repos.deal_scenarios.list(workspaceId, dealId),
      update: (workspaceId, id, changes) => repos.deal_scenarios.update(workspaceId, id, changes),
      remove: (workspaceId, id) => repos.deal_scenarios.remove(workspaceId, id)
    },
    simulationRuns: {
      add: data => repos.simulation_runs.add({ ...data, workspace_id: workspaceId }),
      get: id => repos.simulation_runs.get(workspaceId, id),
      list: (workspaceId, scenarioId) => repos.simulation_runs.list(workspaceId, scenarioId),
      update: (workspaceId, id, changes) => repos.simulation_runs.update(workspaceId, id, changes),
      remove: (workspaceId, id) => repos.simulation_runs.remove(workspaceId, id),
      complete: (workspaceId, id, results, durationMs, costCents) =>
        repos.simulation_runs.complete(workspaceId, id, results, durationMs, costCents)
    },
    integrations: {
      upsert: (connector_id, changes) => repos.integrations.upsert(workspaceId, connector_id, changes),
      get: connector_id => repos.integrations.get(workspaceId, connector_id),
      list: () => repos.integrations.list(workspaceId),
      remove: connector_id => repos.integrations.remove(workspaceId, connector_id)
    },
    plans: {
      create: data => repos.plans.create({ ...data, workspace_id: workspaceId }),
      get: id => repos.plans.get(workspaceId, id),
      list: () => repos.plans.list(workspaceId),
      update: (id, changes) => repos.plans.update(workspaceId, id, changes)
    },
    planSteps: {
      create: data => repos.planSteps.create({ ...data, workspace_id: workspaceId }),
      get: id => repos.planSteps.get(workspaceId, id),
      list: plan_id => repos.planSteps.list(workspaceId, plan_id),
      update: (id, changes) => repos.planSteps.update(workspaceId, id, changes)
    },
    approvals: {
      create: data => repos.approvals.create({ ...data, workspace_id: workspaceId }),
      get: id => repos.approvals.get(workspaceId, id),
      list: status => repos.approvals.list(workspaceId, status),
      update: (id, changes) => repos.approvals.update(workspaceId, id, changes)
    },
    outboundEmails: {
      create: data => repos.outboundEmails.create({ ...data, workspace_id: workspaceId }),
      get: id => repos.outboundEmails.get(workspaceId, id),
      list: opts => repos.outboundEmails.list(workspaceId, opts),
      update: (id, changes) => repos.outboundEmails.update(workspaceId, id, changes)
    },
    outboundJobs: {
      enqueue: data => repos.outboundJobs.enqueue({ ...data, workspace_id: workspaceId }),
      get: id => repos.outboundJobs.get(id),
      list: opts => repos.outboundJobs.list(workspaceId, opts),
      update: (id, changes) => repos.outboundJobs.update(id, changes)
    },
    emailSuppressions: {
      add: data => repos.emailSuppressions.add({ ...data, workspace_id: workspaceId }),
      isSuppressed: email => repos.emailSuppressions.isSuppressed(email),
      list: () => repos.emailSuppressions.list(),
      clear: (email, by) => repos.emailSuppressions.clear(email, by)
    }
  };
}

module.exports = { createRepos, forWorkspace };
