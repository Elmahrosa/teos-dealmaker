-- TEOS DealMaker - PostgreSQL schema
-- Forward-only: safe to re-run, never drops tables.

CREATE TABLE IF NOT EXISTS deals (
    id SERIAL PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PROSPECTING',
    current_agent VARCHAR(50),
    deal_value NUMERIC(12, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_trail (
    id SERIAL PRIMARY KEY,
    deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    agent_name VARCHAR(50) NOT NULL,
    action_type VARCHAR(100) NOT NULL,
    details JSONB,
    version VARCHAR(20)
);

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
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();
