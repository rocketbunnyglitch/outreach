-- 0050_email_suppression_and_stale.sql
--
-- Two related additions:
--
--   1. email_suppression: per-team list of addresses we should never
--      send to. Sources: explicit unsubscribe replies, hard bounces,
--      operator-marked "do not contact". One row per (team, email)
--      makes the check O(index lookup) at send time.
--
--   2. email_threads.is_stale + .sla_due_at: persisted flags so the
--      inbox UI can highlight stale threads without recomputing the
--      SLA on every request. Set by a periodic job
--      (lib/stale-tagger.ts) and reset on operator action.
--
-- Why a separate suppression table when venues.do_not_contact already
-- exists:
--   - Some addresses we want to suppress aren't on a venue row at
--     all (info@randomvendor.com replies "STOP" — no venue).
--   - venues.do_not_contact is a per-venue flag; suppression is a
--     per-address flag. Different cardinality. Both check at send
--     time.

-- =========================================================================
-- email_suppression
-- =========================================================================

CREATE TABLE IF NOT EXISTS email_suppression (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,

  -- Lowercased + trimmed before insert. Unique per team so the
  -- send-path check is a single index lookup.
  email text NOT NULL,

  -- 'manual'      — operator explicitly added (e.g. unsubscribe reply)
  -- 'bounced'     — hard bounce ingested from a bounce notification
  -- 'complained'  — abuse/spam report
  -- 'unsubscribe' — RFC 8058 List-Unsubscribe click
  reason text NOT NULL CHECK (reason IN ('manual', 'bounced', 'complained', 'unsubscribe')),

  -- Optional free-text note ("operator note: spammy domain") and
  -- link to the thread that triggered the suppression (e.g. the
  -- bounce message). Both nullable.
  notes text,
  source_thread_id uuid REFERENCES email_threads (id) ON DELETE SET NULL,

  -- Audit.
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One suppression per (team, email). Case is normalised by the
-- application layer before insert (always lower()).
CREATE UNIQUE INDEX IF NOT EXISTS email_suppression_team_email_unique
  ON email_suppression (team_id, email);

CREATE INDEX IF NOT EXISTS email_suppression_team_idx
  ON email_suppression (team_id);

COMMENT ON TABLE email_suppression IS
  'Per-team list of email addresses that should never receive outbound mail. Checked at send-time alongside venues.do_not_contact. Lowercased + trimmed before insert.';

-- =========================================================================
-- email_threads — stale tagging
-- =========================================================================
--
-- Persisted so the inbox UI can paint the "stale" chip without
-- recomputing SLA windows on every row render. The stale-tagger
-- worker recomputes on a schedule (5-15 min cron); operator
-- actions (reply sent, mark archived) flip is_stale back to false
-- immediately so the UI feels live.

ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS is_stale boolean NOT NULL DEFAULT false;

-- When the thread became stale relative to its SLA. Used by the
-- UI to display "stale 6h" and by the dashboard's stale-count
-- widget. Set by the tagger; cleared on operator action.
ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS stale_since timestamptz;

-- Reason text — short string the UI shows on hover. Example:
-- "venue replied 26h ago; no staff response sent" or
-- "follow-up due 4d after first cold send; no reply received".
ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS stale_reason text;

CREATE INDEX IF NOT EXISTS email_threads_is_stale_idx
  ON email_threads (is_stale)
  WHERE is_stale = true;
