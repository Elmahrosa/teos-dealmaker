-- 016_add_billing_webhook_events.sql
-- Dodo webhook idempotency markers: one row per processed webhook event id.
-- The UNIQUE constraint on event_id makes the dedupe persistence-backed, so a
-- replayed (or attacker-resubmitted) signed event can never re-apply a billing
-- state change, even across processes. Used by db/repos.js
-- (billingWebhookEvents.*) and services/billing. Forward-only and idempotent.

CREATE TABLE IF NOT EXISTS billing_webhook_events (
    id SERIAL PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL UNIQUE,
    event_type VARCHAR(100),
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'processed',
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_event_id ON billing_webhook_events(event_id);

DROP TRIGGER IF EXISTS update_billing_webhook_events_modtime ON billing_webhook_events;
CREATE TRIGGER update_billing_webhook_events_modtime
BEFORE UPDATE ON billing_webhook_events
FOR EACH ROW EXECUTE FUNCTION update_modified_column();