-- 0132: track scheduled-send dispatch failures on email_drafts so the
-- /email-queue page can surface a repeatedly-failing draft (expired token,
-- suppression at send time, ...) instead of showing it as "sending now"
-- forever while the cron silently retries every 5 minutes.
--
-- Expand-only (new columns, defaulted/nullable) per the expand/contract
-- migration policy -- the running release tolerates these columns existing.

ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS send_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS last_send_error text;
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS last_send_error_at timestamptz;
