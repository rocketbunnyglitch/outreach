-- 0049_email_send_events.sql
--
-- Per-send audit + counter source for the daily cold-send cap. Each
-- outbound message inserts exactly one row here at send time; the
-- count of (connected_account_id, category='cold', sent_at in local
-- day) drives both the visible "22 / 30 sent today" counter and the
-- hard cap that blocks further cold sends.
--
-- Why a separate table instead of derived from email_messages:
--   - email_messages may be re-ingested by the poll worker (the same
--     gmail_message_id can appear during recovery from a corrupted
--     history id). Counting from there would over-count.
--   - email_messages doesn't carry the "cold vs warm" classification.
--     We'd have to back-fill it, and the classification rules might
--     evolve.
--   - email_send_events is purely append-only; it's safe to audit
--     and to reason about retroactively.
--
-- Categories (v1):
--   'cold'  — new thread initiated by us (no inbound history before this send)
--   'warm'  — reply on a thread that has at least one inbound message
--             before this send
--
-- The category column is forward-compatible: spec calls for cold /
-- follow_up / warm_reply / operational / internal. v1 collapses to
-- cold vs warm per operator: warm = reply-on-inbound, everything
-- else = cold. We use the string enum so a later migration can
-- expand without dropping data.

CREATE TABLE IF NOT EXISTS email_send_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The connected account this send went out on. CASCADE on delete:
  -- if the account is removed, its send history goes too. (We don't
  -- "delete" accounts in normal operation; they get marked
  -- 'disconnected', which keeps the FK intact.)
  connected_account_id uuid NOT NULL
    REFERENCES connected_accounts (id) ON DELETE CASCADE,

  -- Optional thread linkage so admin can audit per-thread send
  -- history. NULL allowed because a send that crashed mid-flight
  -- still wants to record the cap-counting event.
  thread_id uuid REFERENCES email_threads (id) ON DELETE SET NULL,

  -- The user who triggered the send. Useful for "show me my sends
  -- today" and for the audit trail.
  sent_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,

  -- Recipient — denormalized from the message itself. Useful for
  -- "did we already email this address today" checks without
  -- joining email_messages.
  recipient_email text NOT NULL,

  -- 'cold' counts against the cap; 'warm' does not.
  category text NOT NULL CHECK (category IN ('cold', 'warm')),

  -- Whether this specific send counts against the daily cap.
  -- Stored explicitly (instead of computed from category) because
  -- admin bypass needs to record "this WAS over the cap but admin
  -- forced it" without lying about the category.
  counted_against_cap boolean NOT NULL,

  -- Admin bypass marker: when true, this send went out despite
  -- being over the cap. Always paired with an audit log entry.
  cap_bypassed boolean NOT NULL DEFAULT false,

  sent_at timestamptz NOT NULL DEFAULT now()
);

-- Most queries: "how many cold sends has this account made today?"
-- The cap check runs on every send; this index makes it cheap.
CREATE INDEX IF NOT EXISTS email_send_events_account_sent_at_idx
  ON email_send_events (connected_account_id, sent_at DESC)
  WHERE counted_against_cap = true;

-- Secondary: "show me everything this user sent today" for the
-- dashboard widget.
CREATE INDEX IF NOT EXISTS email_send_events_user_sent_at_idx
  ON email_send_events (sent_by_user_id, sent_at DESC);

-- Per-thread audit lookup.
CREATE INDEX IF NOT EXISTS email_send_events_thread_idx
  ON email_send_events (thread_id)
  WHERE thread_id IS NOT NULL;

-- =========================================================================
-- daily_cold_send_cap column on connected_accounts
-- =========================================================================
--
-- Default 30 per the spec. Per-account override lets an admin raise
-- or lower the cap for a single inbox (e.g. a brand-new account gets
-- a lower cap while it warms up). Always non-null with a default
-- value so the read path doesn't need to coalesce.

ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS daily_cold_send_cap integer NOT NULL DEFAULT 30;

COMMENT ON COLUMN connected_accounts.daily_cold_send_cap IS
  'Hard cap on cold sends per local day, where "local day" is the sender user''s timezone (users.timezone). Default 30.';
