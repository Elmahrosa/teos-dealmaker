-- 013_add_manual_pilot_activations.sql
-- Manual pilot activations: billing entitlement grants for manual_pilot mode.
-- Used by db/repos.js (manualPilotActivations.*) and services/billing. This
-- table previously existed only in the in-memory adapter (db/tables.js) —
-- Postgres deployments failed at activation time. Forward-only and idempotent.

CREATE TABLE IF NOT EXISTS manual_pilot_activations (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    activated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    plan VARCHAR(50) NOT NULL DEFAULT 'manual_pilot',
    notes TEXT,
    activated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deactivated_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_manual_pilot_activations_workspace_status ON manual_pilot_activations(workspace_id, status);

DROP TRIGGER IF EXISTS update_manual_pilot_activations_modtime ON manual_pilot_activations;
CREATE TRIGGER update_manual_pilot_activations_modtime
BEFORE UPDATE ON manual_pilot_activations
FOR EACH ROW EXECUTE FUNCTION update_modified_column();