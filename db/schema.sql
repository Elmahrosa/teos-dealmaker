-- TEOS DealMaker - Multi-tenant PostgreSQL schema (Phase 1)
-- Forward-only: safe to re-run, never drops tables.
-- Every tenant-owned table carries workspace_id; all access is scoped by it.

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE,
    display_name VARCHAR(255),
    telegram_id BIGINT UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspaces (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(80) NOT NULL UNIQUE,
    plan VARCHAR(50) NOT NULL DEFAULT 'solo',
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    subscription_id INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'operator',
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    plan VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
    start_date DATE,
    renewal_date DATE,
    refund_eligibility JSONB,
    provider VARCHAR(50) DEFAULT 'dodo',
    provider_customer_id VARCHAR(120),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dodo_customers (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    dodo_customer_id VARCHAR(120) NOT NULL,
    email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deals (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    company_name VARCHAR(255) NOT NULL,
    stage VARCHAR(50) NOT NULL DEFAULT 'lead',
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    deal_value NUMERIC(12, 2),
    currency VARCHAR(3) DEFAULT 'USD',
    current_agent VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deals_workspace_stage ON deals(workspace_id, stage);
CREATE INDEX IF NOT EXISTS idx_deals_workspace_status ON deals(workspace_id, status);

CREATE TABLE IF NOT EXISTS audit_trail (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
    deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    agent_name VARCHAR(50) NOT NULL,
    action_type VARCHAR(100) NOT NULL,
    details JSONB,
    version VARCHAR(20)
);

CREATE INDEX IF NOT EXISTS idx_audit_workspace_time ON audit_trail(workspace_id, timestamp);

CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    channel VARCHAR(30) DEFAULT 'telegram',
    title VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    tokens INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_workspace_conversation ON messages(workspace_id, conversation_id);

CREATE TABLE IF NOT EXISTS agent_runs (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    agent_name VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    input JSONB,
    output JSONB,
    duration_ms INTEGER,
    provider VARCHAR(50),
    model VARCHAR(100),
    cost_cents INTEGER DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_time ON agent_runs(workspace_id, started_at);

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS provider_usage (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_cents INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_provider_usage_workspace_time ON provider_usage(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS provider_policies (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    agent_type VARCHAR(80) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, agent_type)
);

CREATE INDEX IF NOT EXISTS idx_provider_policies_workspace ON provider_policies(workspace_id);

CREATE TABLE IF NOT EXISTS pipeline_events (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    from_stage VARCHAR(50),
    to_stage VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pipeline_events_workspace_deal ON pipeline_events(workspace_id, deal_id);

CREATE TABLE IF NOT EXISTS agents (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    agent_type VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    provider VARCHAR(50),
    model VARCHAR(100),
    owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    total_runs INTEGER NOT NULL DEFAULT 0,
    total_cost_cents INTEGER NOT NULL DEFAULT 0,
    last_run_at TIMESTAMP WITH TIME ZONE,
    next_run_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agents_workspace_type ON agents(workspace_id, agent_type);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS total_runs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS total_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS workspace_settings (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
    lang VARCHAR(8) NOT NULL DEFAULT 'en',
    timezone VARCHAR(40) NOT NULL DEFAULT 'UTC',
    notifications VARCHAR(10) NOT NULL DEFAULT 'on',
    theme VARCHAR(10) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspace_memory (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    key VARCHAR(80) NOT NULL,
    value JSONB NOT NULL,
    source VARCHAR(30) NOT NULL DEFAULT 'manual',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, key)
);

CREATE INDEX IF NOT EXISTS idx_memory_workspace_key ON workspace_memory(workspace_id, key);

CREATE TABLE IF NOT EXISTS deal_notes (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    agent_name VARCHAR(80) NOT NULL,
    note TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deal_notes_workspace_deal ON deal_notes(workspace_id, deal_id);

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    source_type VARCHAR(50) NOT NULL DEFAULT 'documents',
    content TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_workspace_source ON knowledge_documents(workspace_id, source_type);

CREATE TABLE IF NOT EXISTS integration_connections (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    connector_id VARCHAR(60) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'enabled',
    config JSONB,
    last_synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, connector_id)
);

CREATE INDEX IF NOT EXISTS idx_integration_workspace_connector ON integration_connections(workspace_id, connector_id);

CREATE TABLE IF NOT EXISTS plans (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    goal TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'planned',
    priority VARCHAR(30) DEFAULT 'normal',
    metrics JSONB,
    version VARCHAR(20),
    archived_at TIMESTAMP WITH TIME ZONE NULL,
    is_protected BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plans_workspace_time ON plans(workspace_id, created_at);

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_plan ON agent_runs(workspace_id, plan_id);

CREATE TABLE IF NOT EXISTS plan_steps (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    step_key VARCHAR(30) NOT NULL,
    agent_type VARCHAR(80) NOT NULL,
    step_group VARCHAR(60),
    depends_on JSONB,
    task TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 3,
    provider VARCHAR(50),
    model VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    output TEXT,
    error TEXT,
    review JSONB,
    approval JSONB,
    confidence DOUBLE PRECISION,
    retries INTEGER NOT NULL DEFAULT 0,
    attempt INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plan_steps_workspace_plan ON plan_steps(workspace_id, plan_id);

CREATE TABLE IF NOT EXISTS approval_requests (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    plan_id INTEGER REFERENCES plans(id) ON DELETE CASCADE,
    step_id INTEGER REFERENCES plan_steps(id) ON DELETE CASCADE,
    agent_type VARCHAR(80) NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    decided_at TIMESTAMP WITH TIME ZONE,
    decided_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_approvals_workspace_status ON approval_requests(workspace_id, status);

CREATE TABLE IF NOT EXISTS outbound_emails (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    to_email VARCHAR(255) NOT NULL,
    from_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    campaign VARCHAR(120),
    provider VARCHAR(30),
    provider_message_id VARCHAR(255),
    send_status VARCHAR(30),
    failure_reason TEXT,
    requested_at TIMESTAMP WITH TIME ZONE,
    approved_at TIMESTAMP WITH TIME ZONE,
    approved_by VARCHAR(120),
    rejected_at TIMESTAMP WITH TIME ZONE,
    rejected_by VARCHAR(120),
    sent_at TIMESTAMP WITH TIME ZONE,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_outbound_emails_workspace_status ON outbound_emails(workspace_id, status);

CREATE TABLE IF NOT EXISTS outbound_service_state (
    service VARCHAR(40) PRIMARY KEY,
    state VARCHAR(20) NOT NULL DEFAULT 'PAUSED',
    prior_state VARCHAR(20),
    reason TEXT,
    updated_by VARCHAR(120),
    heartbeat_at TIMESTAMP WITH TIME ZONE,
    last_worker_at TIMESTAMP WITH TIME ZONE,
    last_successful_job_at TIMESTAMP WITH TIME ZONE,
    last_webhook_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    last_error_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outbound_jobs (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    mission_id INTEGER,
    prospect_id INTEGER,
    approval_id INTEGER,
    recipient VARCHAR(255) NOT NULL,
    from_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    body TEXT NOT NULL,
    template VARCHAR(120),
    idempotency_key VARCHAR(190) NOT NULL UNIQUE,
    status VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
    send_status VARCHAR(30),
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    next_attempt_at TIMESTAMP WITH TIME ZONE,
    lease_until TIMESTAMP WITH TIME ZONE,
    provider VARCHAR(30),
    provider_message_id VARCHAR(255),
    message_id_header VARCHAR(255),
    failure_reason TEXT,
    approved_by VARCHAR(120),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP WITH TIME ZONE,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_outbound_jobs_status_next ON outbound_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbound_jobs_workspace_status ON outbound_jobs(workspace_id, status);

CREATE TABLE IF NOT EXISTS email_suppressions (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    reason VARCHAR(40) NOT NULL,
    source_event VARCHAR(60),
    source_job_id INTEGER,
    suppressed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    cleared_at TIMESTAMP WITH TIME ZONE,
    cleared_by VARCHAR(120)
);

CREATE INDEX IF NOT EXISTS idx_suppressions_email ON email_suppressions(email, cleared_at);

CREATE TABLE IF NOT EXISTS resend_events (
    id SERIAL PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL UNIQUE,
    event_type VARCHAR(40) NOT NULL,
    email_id VARCHAR(255),
    job_id INTEGER,
    message_id_header VARCHAR(255),
    recipient VARCHAR(255),
    payload JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'handled',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_resend_events_email ON resend_events(email_id);

CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_deals_modtime ON deals;
CREATE TRIGGER update_deals_modtime
BEFORE UPDATE ON deals
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_workspaces_modtime ON workspaces;
CREATE TRIGGER update_workspaces_modtime
BEFORE UPDATE ON workspaces
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_subscriptions_modtime ON subscriptions;
CREATE TRIGGER update_subscriptions_modtime
BEFORE UPDATE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_users_modtime ON users;
CREATE TRIGGER update_users_modtime
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_workspace_settings_modtime ON workspace_settings;
CREATE TRIGGER update_workspace_settings_modtime
BEFORE UPDATE ON workspace_settings
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_agents_modtime ON agents;
CREATE TRIGGER update_agents_modtime
BEFORE UPDATE ON agents
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_plans_modtime ON plans;
CREATE TRIGGER update_plans_modtime
BEFORE UPDATE ON plans
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_plan_steps_modtime ON plan_steps;
CREATE TRIGGER update_plan_steps_modtime
BEFORE UPDATE ON plan_steps
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_outbound_emails_modtime ON outbound_emails;
CREATE TRIGGER update_outbound_emails_modtime
BEFORE UPDATE ON outbound_emails
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_outbound_service_state_modtime ON outbound_service_state;
CREATE TRIGGER update_outbound_service_state_modtime
BEFORE UPDATE ON outbound_service_state
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_outbound_jobs_modtime ON outbound_jobs;
CREATE TRIGGER update_outbound_jobs_modtime
BEFORE UPDATE ON outbound_jobs
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- Mission intake: one-shot customer funnel (the real /start funnel).
CREATE TABLE IF NOT EXISTS mission_intakes (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    outcome TEXT,
    target_customer TEXT,
    market TEXT,
    budget TEXT,
    timeline TEXT,
    capabilities TEXT,
    contact VARCHAR(500),
    status VARCHAR(40) NOT NULL DEFAULT 'received',
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mission_intakes_created ON mission_intakes(created_at);
