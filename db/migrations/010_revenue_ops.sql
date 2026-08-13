-- 010_revenue_ops.sql
-- 24/7 Revenue Operations persistence:
--   prospects            target-customer engine records (scoring, pipeline, provenance)
--   founder_reports      3-hour founder report persistence (idempotent windows)
--   revenue_ops_state    scheduler/operating state (heartbeat, window claims, mode)

CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS prospects (
    id SERIAL PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    person_name VARCHAR(255),
    website VARCHAR(500),
    source VARCHAR(120) NOT NULL,
    category VARCHAR(120),
    offer TEXT,
    pain_point TEXT,
    score INTEGER NOT NULL DEFAULT 0,
    score_reason TEXT,
    score_source VARCHAR(120),
    score_timestamp TIMESTAMP WITH TIME ZONE,
    confidence INTEGER,
    contact_email VARCHAR(255),
    contact_channel VARCHAR(60),
    status VARCHAR(40) NOT NULL DEFAULT 'DISCOVERED',
    stage VARCHAR(40) NOT NULL DEFAULT 'discovered',
    qualification TEXT,
    sentinel_verdict VARCHAR(10),
    mission_id INTEGER,
    audit_ref VARCHAR(255),
    last_action VARCHAR(120),
    next_action VARCHAR(120),
    suppressed_at TIMESTAMP WITH TIME ZONE,
    suppressed_reason TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_prospects_stage ON prospects(stage);
CREATE INDEX IF NOT EXISTS idx_prospects_score ON prospects(score DESC);

CREATE TABLE IF NOT EXISTS founder_reports (
    id SERIAL PRIMARY KEY,
    report_id VARCHAR(80) NOT NULL UNIQUE,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL,
    window_end TIMESTAMP WITH TIME ZONE NOT NULL,
    period_label VARCHAR(40),
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    recipient VARCHAR(255) NOT NULL,
    sender VARCHAR(255) NOT NULL,
    subject VARCHAR(500),
    delivery_status VARCHAR(30) NOT NULL DEFAULT 'generated',
    provider VARCHAR(30),
    provider_message_id VARCHAR(255),
    failure_reason TEXT,
    resend_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    metrics JSONB,
    audit_ref VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_founder_reports_window ON founder_reports(window_end DESC);
CREATE INDEX IF NOT EXISTS idx_founder_reports_status ON founder_reports(delivery_status);

CREATE TABLE IF NOT EXISTS revenue_ops_state (
    key VARCHAR(80) PRIMARY KEY,
    value VARCHAR(255),
    payload JSONB,
    heartbeat_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_prospects_modtime ON prospects;
CREATE TRIGGER update_prospects_modtime
BEFORE UPDATE ON prospects
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_founder_reports_modtime ON founder_reports;
CREATE TRIGGER update_founder_reports_modtime
BEFORE UPDATE ON founder_reports
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_revenue_ops_state_modtime ON revenue_ops_state;
CREATE TRIGGER update_revenue_ops_state_modtime
BEFORE UPDATE ON revenue_ops_state
FOR EACH ROW EXECUTE FUNCTION update_modified_column();
