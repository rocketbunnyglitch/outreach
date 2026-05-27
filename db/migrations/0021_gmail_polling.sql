-- 0021_gmail_polling.sql
-- =========================================================================
-- Add gmail_last_polled_at to staff_outreach_emails so the polling worker
-- can fairly rotate across inboxes (least-recently-polled first).
-- =========================================================================

ALTER TABLE staff_outreach_emails
  ADD COLUMN IF NOT EXISTS gmail_last_polled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS staff_outreach_emails_gmail_poll_idx
  ON staff_outreach_emails (gmail_last_polled_at NULLS FIRST)
  WHERE gmail_oauth_refresh_token IS NOT NULL AND archived_at IS NULL;

COMMENT ON COLUMN staff_outreach_emails.gmail_last_polled_at
  IS 'Set by the gmail polling worker on every pass, regardless of outcome. Order-by NULLS FIRST so brand-new inboxes get polled first.';
