const TABLES = {
  workspaces: {
    columns: ['name', 'slug', 'plan', 'status', 'owner_user_id', 'subscription_id'],
    timestamps: true
  },
  users: {
    columns: ['email', 'display_name', 'telegram_id'],
    timestamps: true
  },
  workspace_members: {
    columns: ['workspace_id', 'user_id', 'role']
  },
  subscriptions: {
    columns: ['workspace_id', 'plan', 'status', 'cycle', 'start_date', 'renewal_date', 'refund_eligibility', 'provider', 'provider_customer_id'],
    timestamps: true
  },
  dodo_customers: {
    columns: ['workspace_id', 'dodo_customer_id', 'email']
  },
  deals: {
    columns: ['workspace_id', 'company_name', 'stage', 'status', 'deal_value', 'currency', 'current_agent'],
    timestamps: true
  },
  audit_trail: {
    columns: ['workspace_id', 'deal_id', 'user_id', 'timestamp', 'agent_name', 'action_type', 'details', 'version']
  },
  conversations: {
    columns: ['workspace_id', 'user_id', 'channel', 'title']
  },
  messages: {
    columns: ['workspace_id', 'conversation_id', 'role', 'content', 'tokens']
  },
  agent_runs: {
    columns: ['workspace_id', 'deal_id', 'agent_name', 'status', 'input', 'output', 'duration_ms', 'provider', 'model', 'cost_cents', 'started_at', 'completed_at']
  },
  provider_usage: {
    columns: ['workspace_id', 'provider', 'model', 'input_tokens', 'output_tokens', 'cost_cents'],
    timestamps: true
  },
  pipeline_events: {
    columns: ['workspace_id', 'deal_id', 'from_stage', 'to_stage'],
    timestamps: true
  },
  provider_policies: {
    columns: ['workspace_id', 'agent_type', 'provider', 'model'],
    timestamps: true
  },
  agents: {
    columns: ['workspace_id', 'agent_type', 'status', 'provider', 'model', 'owner_user_id', 'total_runs', 'total_cost_cents', 'last_run_at', 'next_run_at'],
    timestamps: true
  },
  workspace_settings: {
    columns: ['workspace_id', 'lang', 'timezone', 'notifications', 'theme'],
    timestamps: true
  },
  workspace_memory: {
    columns: ['workspace_id', 'key', 'value', 'source'],
    timestamps: true
  },
  deal_notes: {
    columns: ['workspace_id', 'deal_id', 'agent_name', 'note'],
    timestamps: true
  },
  knowledge_documents: {
    columns: ['workspace_id', 'title', 'source_type', 'content', 'metadata'],
    timestamps: true
  },
  integration_connections: {
    columns: ['workspace_id', 'connector_id', 'status', 'config', 'last_synced_at'],
    timestamps: true
  }
};

module.exports = { TABLES };
