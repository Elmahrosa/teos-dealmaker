-- 001_fix_fk_ordering.sql
-- Forward-only schema-ordering fix for existing deployments.
--
-- The original schema.sql declared FK targets before their tables:
--   1. workspaces.owner_user_id -> users(id)   (users defined AFTER workspaces)
--   2. agent_runs.plan_id       -> plans(id)   (ALTER ran BEFORE plans existed)
--
-- Fresh installs are fixed by the reordered schema.sql itself. This migration
-- re-asserts the plan_id column + index in the correct order for databases
-- that were migrated under the old file. Idempotent and safe to re-run.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_plan ON agent_runs(workspace_id, plan_id);
