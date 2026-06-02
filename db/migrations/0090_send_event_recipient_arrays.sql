-- =========================================================================
-- 0090_send_event_recipient_arrays.sql
--
-- Record ALL recipients of a send, not just the primary To.
--
-- email_send_events.recipient_email stores only the first To address, so
-- the per-send audit log loses Cc and Bcc recipients and any additional To
-- addresses entirely. These three nullable text[] columns capture the full,
-- normalized (lowercased) recipient set written by recordSendEvent
-- (lib/send-cap.ts) when the caller supplies it.
--
--   to_emails_normalized   text[]  all To addresses, lowercased.  NULL when
--                                   the caller did not supply the list
--                                   (legacy callers / older rows).
--   cc_emails_normalized   text[]  all Cc addresses, lowercased.  NULL as
--                                   above.
--   bcc_emails_normalized  text[]  all Bcc addresses, lowercased. NULL as
--                                   above.
--
-- recipient_email is unchanged and remains the primary To for backward
-- compatibility. All three columns are nullable with no default: existing
-- rows stay NULL and nothing reads them as required. Idempotent via
-- ADD COLUMN IF NOT EXISTS.
-- =========================================================================

ALTER TABLE email_send_events ADD COLUMN IF NOT EXISTS to_emails_normalized text[];
ALTER TABLE email_send_events ADD COLUMN IF NOT EXISTS cc_emails_normalized text[];
ALTER TABLE email_send_events ADD COLUMN IF NOT EXISTS bcc_emails_normalized text[];
