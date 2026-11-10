-- 017_audit_outbox.sql
-- Transactional outbox for lifecycle audit events. A row is inserted in the same
-- transaction as the state change it describes (db/repos.js deals.closeWon), then
-- delivered to the hash-chained vault by services/auditOutbox.js. event_id is the
-- stable idempotency key that is also stored in the vault entry's details, so a
-- retried delivery can never duplicate a vault entry. Forward-only and idempotent.

CREATE TABLE IF NOT EXISTS audit_outbox (
    id SERIAL PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
    deal_id INTEGER,
    action VARCHAR(100) NOT NULL,
    target VARCHAR(255),
    status VARCHAR(50),
    details JSONB,
    state VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    vault_hash VARCHAR(128),
    delivered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT audit_outbox_state_check CHECK (state IN ('pending', 'failed', 'delivered'))
);

CREATE INDEX IF NOT EXISTS idx_audit_outbox_state ON audit_outbox(state, id);

DROP TRIGGER IF EXISTS update_audit_outbox_modtime ON audit_outbox;
CREATE TRIGGER update_audit_outbox_modtime
BEFORE UPDATE ON audit_outbox
FOR EACH ROW EXECUTE FUNCTION update_modified_column();
