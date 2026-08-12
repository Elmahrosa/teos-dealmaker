-- Add archival and protection columns to plans table
ALTER TABLE plans ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT FALSE;