const TABLES = {
  workspaces: {
    columns: ['name', 'slug', 'plan', 'status', 'owner_user_id', 'subscription_id'],
    timestamps: true
  },
  users: {
    columns: ['email', 'display_name', 'telegram_id', 'password_hash', 'salt'],
    timestamps: true
  },
  workspace_members: {
    columns: ['workspace_id', 'user_id', 'role']
  },
  subscriptions: {
    columns: ['workspace_id', 'plan', 'status', 'cycle', 'start_date', 'renewal_date', 'refund_eligibility', 'provider', 'provider_customer_id', 'missions_used'],
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
    columns: ['workspace_id', 'deal_id', 'plan_id', 'agent_name', 'status', 'input', 'output', 'duration_ms', 'provider', 'model', 'cost_cents', 'started_at', 'completed_at']
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
  },
  plans: {
    columns: ['workspace_id', 'title', 'goal', 'status', 'priority', 'metrics', 'version', 'archived_at', 'is_protected'],
    timestamps: true
  },
  plan_steps: {
    columns: ['workspace_id', 'plan_id', 'step_key', 'agent_type', 'step_group', 'depends_on', 'task', 'priority', 'provider', 'model', 'status', 'output', 'error', 'review', 'approval', 'confidence', 'retries', 'attempt', 'started_at', 'completed_at']
  },
  approval_requests: {
    columns: ['workspace_id', 'plan_id', 'step_id', 'agent_type', 'reason', 'status', 'requested_at', 'decided_at', 'decided_by']
  },

  outbound_emails: {
    columns: ['workspace_id', 'to_email', 'from_email', 'subject', 'body', 'status', 'campaign', 'provider', 'provider_message_id', 'send_status', 'failure_reason', 'requested_at', 'approved_at', 'approved_by', 'rejected_at', 'rejected_by', 'sent_at', 'confirmed_at'],
    timestamps: true
  },

  outbound_service_state: {
    columns: ['service', 'state', 'prior_state', 'reason', 'updated_by', 'heartbeat_at', 'last_worker_at', 'last_successful_job_at', 'last_webhook_at', 'last_error', 'last_error_at'],
    timestamps: true
  },

  outbound_jobs: {
    columns: ['workspace_id', 'mission_id', 'prospect_id', 'approval_id', 'recipient', 'from_email', 'subject', 'body', 'template', 'idempotency_key', 'status', 'send_status', 'retry_count', 'max_retries', 'next_attempt_at', 'lease_until', 'provider', 'provider_message_id', 'message_id_header', 'failure_reason', 'approved_by', 'approved_at', 'sent_at', 'confirmed_at'],
    timestamps: true
  },

  email_suppressions: {
    columns: ['workspace_id', 'email', 'reason', 'source_event', 'source_job_id', 'suppressed_at', 'cleared_at', 'cleared_by']
  },

  resend_events: {
    columns: ['event_id', 'event_type', 'email_id', 'job_id', 'message_id_header', 'recipient', 'payload', 'status', 'processed_at'],
    timestamps: true
  },

  deal_scenarios: {
    columns: ['workspace_id', 'deal_id', 'name', 'description', 'scenario_type', 'parameters'],
    timestamps: true
  },

  simulation_runs: {
    columns: ['workspace_id', 'deal_scenario_id', 'status', 'started_at', 'completed_at', 'duration_ms', 'cost_cents', 'results'],
    timestamps: true
  },

  mission_intakes: {
    columns: ['title', 'objective', 'outcome', 'target_customer', 'market', 'budget', 'timeline', 'capabilities', 'contact', 'status', 'answers'],
    timestamps: true
  },

  prospects: {
    columns: ['company_name', 'person_name', 'website', 'source', 'category', 'offer', 'pain_point', 'score', 'score_reason', 'score_source', 'score_timestamp', 'confidence', 'contact_email', 'contact_channel', 'status', 'stage', 'qualification', 'sentinel_verdict', 'mission_id', 'audit_ref', 'last_action', 'next_action', 'suppressed_at', 'suppressed_reason', 'metadata'],
    timestamps: true
  },

  founder_reports: {
    columns: ['report_id', 'window_start', 'window_end', 'period_label', 'generated_at', 'recipient', 'sender', 'subject', 'delivery_status', 'provider', 'provider_message_id', 'failure_reason', 'resend_count', 'last_attempt_at', 'metrics', 'audit_ref'],
    timestamps: true
  },

  revenue_ops_state: {
    columns: ['key', 'value', 'payload', 'heartbeat_at'],
    timestamps: true
  }
};

module.exports = { TABLES };
