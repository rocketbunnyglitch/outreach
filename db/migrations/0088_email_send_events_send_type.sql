-- Operational send-type taxonomy on email_send_events.
--
-- email_send_events.category (cold/warm) drives the daily cold-send
-- cap. It does NOT capture the operational INTENT of a send -- e.g.
-- transactional/internal/operational mail that should be audited but
-- must NOT consume the 30/day cold budget.
--
-- send_type records that intent:
--   'cold'        a cold outreach send (counts against the cap)
--   'warm'        a reply on a warm thread (does not count)
--   'operational' transactional/internal mail (does not count)
--
-- counted_against_cap remains the AUTHORITATIVE cap flag read by
-- loadSendUsage; send_type is the operational category for analytics
-- and future routing. For existing callers send_type mirrors category,
-- so the cap behaves exactly as before.
--
-- Backfill: every existing row's send_type is set from its category
-- (cold/warm). The column defaults to 'cold' so any row inserted by
-- pre-deploy code during the rollout window still gets a sane value.
-- Idempotent: ADD COLUMN IF NOT EXISTS + a backfill guarded so it only
-- touches rows that still hold the default.

ALTER TABLE email_send_events
  ADD COLUMN IF NOT EXISTS send_type text NOT NULL DEFAULT 'cold';

-- Backfill operational category from the existing cap classification.
-- Warm rows become send_type='warm'; everything else stays 'cold'
-- (the column default). One-shot and safe to re-run.
UPDATE email_send_events
  SET send_type = category
  WHERE send_type = 'cold'
    AND category IN ('cold', 'warm');

-- Analytics index: scope by operational type over time without a
-- table scan. Partial on the non-default values keeps it small.
CREATE INDEX IF NOT EXISTS email_send_events_send_type_idx
  ON email_send_events (send_type, sent_at DESC)
  WHERE send_type <> 'cold';
