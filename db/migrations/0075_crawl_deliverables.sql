-- Operator request: Crawl Management tab.
--
-- For every venue_event in every crawl, the team needs to track
-- a checklist of operational deliverables before the crawl runs:
--
--   - Social Media Graphics  (created + posted)
--   - Staff Sheet            (assembled + distributed)
--   - Participant Poster     (designed + printed + delivered)
--   - Wristbands             (LINKED to existing wristbands table —
--                              don't store status here, look it up.
--                              Only applies to wristband-role venues.)
--   - Week of Confirmation   (re-confirmed within 7 days of the crawl —
--                              tracked separately even though most ops
--                              would re-confirm via a thread reply.)
--
-- Each deliverable has a simple status: pending | done | n_a. The
-- "n_a" case covers e.g. a non-wristband venue not needing a
-- wristband row, or a day-party crawl skipping the final venue.
--
-- Rather than a column per deliverable (rigid + hard to extend),
-- this is a per-(venue_event, deliverable_type) row in a small
-- normalized table. New deliverable types can be added by inserting
-- new enum values + new rows without schema changes elsewhere.

DO $$ BEGIN
  CREATE TYPE crawl_deliverable_type AS ENUM (
    'social_media_graphics',
    'staff_sheet',
    'participant_poster',
    'wristbands',
    'week_of_confirmation'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE crawl_deliverable_status AS ENUM ('pending', 'done', 'n_a');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS crawl_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The venue_event this checklist row applies to. Cascade-delete
  -- when the venue_event row goes away (e.g. a venue is unassigned).
  venue_event_id uuid NOT NULL
    REFERENCES venue_events(id) ON DELETE CASCADE,

  -- Which deliverable. One row per (venue_event_id, type).
  deliverable_type crawl_deliverable_type NOT NULL,

  -- Current state. UI defaults to 'pending'; 'n_a' is the explicit
  -- "this deliverable doesn't apply here" so we don't have to nag
  -- about it.
  status crawl_deliverable_status NOT NULL DEFAULT 'pending',

  -- Optional free-text note ("delivered via Slack to manager Mike
  -- Mar 12"). Helpful for retro audits.
  notes text,

  -- Who flipped it last, when, and which staff member it's
  -- currently waiting on (if any).
  assigned_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES staff_members(id) ON DELETE SET NULL
);

-- Unique per (venue_event, type) so we can upsert cleanly.
CREATE UNIQUE INDEX IF NOT EXISTS crawl_deliverables_unique
  ON crawl_deliverables (venue_event_id, deliverable_type);

CREATE INDEX IF NOT EXISTS crawl_deliverables_assigned_idx
  ON crawl_deliverables (assigned_staff_id, status)
  WHERE status = 'pending';
