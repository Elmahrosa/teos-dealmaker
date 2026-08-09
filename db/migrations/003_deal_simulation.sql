-- 003_deal_simulation.sql
-- Add tables for deal simulation engine: scenarios and runs

-- Deal Scenarios table for storing different simulation scenarios per deal
CREATE TABLE IF NOT EXISTS deal_scenarios (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    scenario_type VARCHAR(50), -- e.g., 'stakeholder_analysis', 'financial_model', 'risk_assessment'
    parameters JSONB, -- Simulation parameters, assumptions, stakeholder models, variables
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_deal_scenarios_workspace_deal ON deal_scenarios(workspace_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_scenarios_type ON deal_scenarios(scenario_type);

-- Simulation Runs table for tracking individual simulation executions
CREATE TABLE IF NOT EXISTS simulation_runs (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    deal_scenario_id INTEGER NOT NULL REFERENCES deal_scenarios(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,
    cost_cents INTEGER DEFAULT 0,
    results JSONB, -- Simulation outcomes, recommendations, confidence scores
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_workspace_status ON simulation_runs(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_simulation_runs_scenario ON simulation_runs(deal_scenario_id);

-- Add triggers for automatic timestamp updates
DROP TRIGGER IF EXISTS update_deal_scenarios_modtime ON deal_scenarios;
CREATE TRIGGER update_deal_scenarios_modtime
BEFORE UPDATE ON deal_scenarios
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_simulation_runs_modtime ON simulation_runs;
CREATE TRIGGER update_simulation_runs_modtime
BEFORE UPDATE ON simulation_runs
FOR EACH ROW EXECUTE FUNCTION update_modified_column();