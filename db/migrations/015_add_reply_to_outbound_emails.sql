-- 015_add_reply_to_outbound_emails.sql
-- Reply-To support for governed outbound email (work-email spec): the sender
-- address on outbound_emails can differ from the reply destination, so the
-- message must carry an optional reply-to. Forward-only and idempotent.
-- The column is nullable: existing rows and drafts that omit a reply-to have
-- NULL, and the Resend payload omits the field in that case.

ALTER TABLE outbound_emails ADD COLUMN IF NOT EXISTS reply_to VARCHAR(255);