-- 002_add_plan_steps_modtime.sql
-- Forward-only migration for existing deployments.
--
-- plan_steps carried a BEFORE UPDATE trigger (update_plan_steps_modtime) that
-- sets NEW.updated_at, but the table had no updated_at column — every plan_step
-- UPDATE on PostgreSQL died with: record "new" has no field "updated_at".
-- The reordered schema.sql now declares both columns; this migration adds them
-- for databases already migrated. Idempotent and safe to re-run.
ALTER TABLE plan_steps ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE plan_steps ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
