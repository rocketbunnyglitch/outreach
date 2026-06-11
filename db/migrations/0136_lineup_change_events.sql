-- 0136: durable lineup change events (CRM plan B1, 2026-06-11).
--
-- The in-memory ring buffer in lib/lineup-events.ts loses every change
-- on a PM2 restart and never fans out across processes, so an external
-- consumer (Smart Map, Eventbrite venue-block pusher) could silently
-- miss lineup changes. This table is the durable append-only log:
-- every lineup-mutating action (confirm, cancel, add/remove venue,
-- slot/time edits) writes a row, and pollers read forward from a
-- cursor so a restarted consumer never misses an event.
--
-- `seq` is the poll cursor: bigserial gives stable, gap-tolerant,
-- strictly-increasing ordering. `public_payload` carries ONLY
-- public-safe lineup facts (venue name, role, slot times, statuses) —
-- never notes, contacts, DNC reasons, or financials (never-do #6);
-- writes go through the sanitizer in lib/lineup-change-core.ts.
--
-- Expand-only: one new table, nothing else touched.

CREATE TABLE IF NOT EXISTS lineup_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Strictly-increasing poll cursor. Consumers poll
  -- GET /api/engine/lineup/changes?since=<seq>.
  seq bigserial NOT NULL,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  venue_event_id uuid REFERENCES venue_events(id) ON DELETE SET NULL,
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  -- 'confirmed' | 'swapped' | 'cancelled' | 'slot_changed'
  -- | 'times_changed' | 'venue_added' | 'venue_removed'
  change_type text NOT NULL CHECK (change_type IN (
    'confirmed', 'swapped', 'cancelled', 'slot_changed',
    'times_changed', 'venue_added', 'venue_removed'
  )),
  -- Public-safe facts only (sanitized allowlist before insert).
  public_payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lineup_change_events_seq_idx
  ON lineup_change_events (seq);

CREATE INDEX IF NOT EXISTS lineup_change_events_event_seq_idx
  ON lineup_change_events (event_id, seq);
