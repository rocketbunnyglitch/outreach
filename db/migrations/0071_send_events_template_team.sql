-- Phase C.1 — Template + team tracking on email_send_events.
--
-- email_send_events captures every send for the cap counter,
-- but does NOT record which template was used or which team
-- owns the send. Phase C needs both:
--
--   template_id     to compute per-template reply rate, warm
--                    rate, time-to-reply
--   team_id         to scope analytics queries to the calling
--                    team without joining through connected
--                    accounts → staff_members on every read
--
-- Both nullable + indexed. template_id NULL = freeform compose
-- (no template used). team_id was always derivable via the
-- connected account, but storing it directly cuts ~50ms off
-- every analytics query at scale.
--
-- Backfill: team_id can be backfilled from the inbox's owner
-- in a separate one-shot. template_id can only be set going
-- forward — the original sends don't know what template they
-- used. Old data shows up as "(no template)" in analytics
-- which is fine.

ALTER TABLE email_send_events
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES email_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS email_send_events_template_idx
  ON email_send_events (template_id, sent_at DESC)
  WHERE template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_send_events_team_idx
  ON email_send_events (team_id, sent_at DESC)
  WHERE team_id IS NOT NULL;

-- Backfill team_id from the inbox's owner. One-shot — running
-- this again is idempotent (the WHERE excludes already-set
-- rows). Existing rows get the right team; new rows get
-- written with team_id at insert time (compose-send-impl
-- update below).
UPDATE email_send_events ese
SET team_id = soe.team_id
FROM staff_outreach_emails soe
WHERE ese.connected_account_id = soe.id
  AND ese.team_id IS NULL;
