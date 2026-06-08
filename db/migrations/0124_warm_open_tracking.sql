-- Warm-only email open tracking (P0 deliverability-gated).
--
-- Tracks when a venue READS our email, but ONLY on warm threads (the venue has
-- already replied). Cold / no-reply sends are NEVER tracked -- enforced in code
-- by lib/open-tracking-gate.ts (shouldTrackOpens). Opens are a SOFT signal:
-- informational only, they never drive cadence or automation.
--
-- Additive + nullable; safe to re-run.

-- 1. Per-open hit log (append-only).
CREATE TABLE IF NOT EXISTS email_open_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip TEXT,
  user_agent TEXT,
  -- True when the open looks like a mail-proxy pre-fetch (Gmail/Apple MPP),
  -- not a confident human read.
  is_likely_proxy BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS email_open_events_message_idx ON email_open_events(email_message_id);

-- 2. Tracking state on the sent message. tracking_token is set ONLY when the
--    warm-only gate allowed a pixel; cold sends leave it NULL (= untracked).
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS tracking_token UUID;
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS first_opened_at TIMESTAMPTZ;
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ;
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0;
-- Unique (sparse) so the public pixel endpoint can look a message up by token.
CREATE UNIQUE INDEX IF NOT EXISTS email_messages_tracking_token_idx
  ON email_messages(tracking_token);

-- 3. Global runtime kill-switch (single-team app -> team-level flag is global).
--    Lets an admin pause open tracking INSTANTLY without a redeploy.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS open_tracking_paused BOOLEAN NOT NULL DEFAULT FALSE;
