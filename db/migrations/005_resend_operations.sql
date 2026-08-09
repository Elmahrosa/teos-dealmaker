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

ALTER TABLE outbound_jobs ADD COLUMN IF NOT EXISTS send_status VARCHAR(30);

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

DROP TRIGGER IF EXISTS update_outbound_service_state_modtime ON outbound_service_state;
CREATE TRIGGER update_outbound_service_state_modtime
BEFORE UPDATE ON outbound_service_state
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_outbound_jobs_modtime ON outbound_jobs;
CREATE TRIGGER update_outbound_jobs_modtime
BEFORE UPDATE ON outbound_jobs
FOR EACH ROW EXECUTE FUNCTION update_modified_column();
