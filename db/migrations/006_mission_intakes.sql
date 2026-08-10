-- Migration 006: mission_intakes table for the one-shot /start funnel.
-- One-shot customer funnel (the real /start funnel).
CREATE TABLE IF NOT EXISTS mission_intakes (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    outcome TEXT,
    target_customer TEXT,
    market TEXT,
    budget TEXT,
    timeline TEXT,
    capabilities TEXT,
    contact VARCHAR(500),
    status VARCHAR(40) NOT NULL DEFAULT 'received',
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mission_intakes_created ON mission_intakes(created_at);
