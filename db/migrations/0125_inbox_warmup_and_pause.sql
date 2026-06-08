-- Inbox warm-up ramp + deliverability auto-pause (connected_accounts).
--
-- warmup_started_at: when this inbox began warming up. NULL = established
--   inbox, no ramp (full configured cap). Set on newly-connected inboxes so
--   their effective daily cold cap ramps from a small floor up to the
--   configured cap over ~3 weeks (lib/inbox-warmup.ts). New domains that blast
--   their full cap on day one get throttled by Google.
--
-- cold_sends_paused: operator/auto deliverability stop. While true, the
--   send-cap preflight blocks COLD sends from this inbox (warm replies still
--   go). Set by the bounce/complaint monitor or an admin toggle.
--
-- Additive + nullable/defaulted; safe to re-run.

ALTER TABLE connected_accounts ADD COLUMN IF NOT EXISTS warmup_started_at TIMESTAMPTZ;
ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS cold_sends_paused BOOLEAN NOT NULL DEFAULT FALSE;
