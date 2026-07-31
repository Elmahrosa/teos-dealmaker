const TABLES = {
  workspaces: {
    columns: ['name', 'slug', 'plan', 'status'],
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
    columns: ['workspace_id', 'deal_id', 'timestamp', 'agent_name', 'action_type', 'details', 'version']
  },
  conversations: {
    columns: ['workspace_id', 'user_id', 'channel', 'title']
  },
  messages: {
    columns: ['workspace_id', 'conversation_id', 'role', 'content', 'tokens']
  },
  agent_runs: {
    columns: ['workspace_id', 'agent_name', 'status', 'input', 'output', 'duration_ms', 'provider', 'model', 'cost_cents', 'completed_at']
  },
  provider_usage: {
    columns: ['workspace_id', 'provider', 'model', 'input_tokens', 'output_tokens', 'cost_cents']
  },
  pipeline_events: {
    columns: ['workspace_id', 'deal_id', 'from_stage', 'to_stage']
  }
};

module.exports = { TABLES };
