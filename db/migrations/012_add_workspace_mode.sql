-- 012_add_workspace_mode.sql
-- Add dry_mode column for per-workspace DRY/LIVE control
-- Part of Phase 1: 24/7 autonomous sales activation

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS dry_mode VARCHAR(10) NOT NULL DEFAULT 'dry';

-- Set founder workspace to LIVE by default
UPDATE workspaces SET dry_mode = 'live' WHERE plan = 'founder';

-- Index for quick mode lookups during sales loop
CREATE INDEX IF NOT EXISTS idx_workspaces_dry_mode ON workspaces(dry_mode);
