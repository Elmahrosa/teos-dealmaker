CREATE TABLE IF NOT EXISTS outbound_emails (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    to_email VARCHAR(255) NOT NULL,
    from_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    campaign VARCHAR(120),
    provider VARCHAR(30),
    provider_message_id VARCHAR(255),
    send_status VARCHAR(30),
    failure_reason TEXT,
    requested_at TIMESTAMP WITH TIME ZONE,
    approved_at TIMESTAMP WITH TIME ZONE,
    approved_by VARCHAR(120),
    rejected_at TIMESTAMP WITH TIME ZONE,
    rejected_by VARCHAR(120),
    sent_at TIMESTAMP WITH TIME ZONE,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_outbound_emails_workspace_status ON outbound_emails(workspace_id, status);

DROP TRIGGER IF EXISTS update_outbound_emails_modtime ON outbound_emails;
CREATE TRIGGER update_outbound_emails_modtime
BEFORE UPDATE ON outbound_emails
FOR EACH ROW EXECUTE FUNCTION update_modified_column();
