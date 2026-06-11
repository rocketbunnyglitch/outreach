-- 0137: replacement push lifecycle (CRM plan B2, 2026-06-11).
--
-- The emergency replacement push (lib/emergency-replacement.ts) batch-
-- drafts outreach to backup venues when a confirmed venue drops — but
-- it had no durable state: nothing recorded WHICH drafts belonged to
-- a push, so when the first backup confirmed, the remaining sibling
-- drafts stayed live and an operator could accidentally send "can you
-- fill Friday?" to ten more venues for a slot that was already filled.
--
-- replacement_pushes is the playbook record: one row per push, status
-- open -> filled (a venue confirmed into the event+role) or closed
-- (superseded/abandoned). email_drafts.replacement_push_id ties each
-- batch draft to its push so the confirm path can cancel unsent
-- siblings atomically.
--
-- Expand-only: one new table + one nullable FK column on email_drafts.

CREATE TABLE IF NOT EXISTS replacement_pushes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  -- 'wristband' | 'middle' | 'final' | 'alt_final'
  role text NOT NULL,
  slot_position integer,
  reason text NOT NULL,
  -- 'open' | 'filled' | 'closed'
  status text NOT NULL DEFAULT 'open',
  drafts_created integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  filled_by_venue_event_id uuid REFERENCES venue_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS replacement_pushes_open_idx
  ON replacement_pushes (event_id, role) WHERE status = 'open';

ALTER TABLE email_drafts
  ADD COLUMN IF NOT EXISTS replacement_push_id uuid
    REFERENCES replacement_pushes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS email_drafts_replacement_push_idx
  ON email_drafts (replacement_push_id) WHERE replacement_push_id IS NOT NULL;
