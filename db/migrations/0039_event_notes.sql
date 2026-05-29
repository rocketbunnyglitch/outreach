-- 0039_event_notes.sql
-- Per-crawl free-text note that surfaces in the tracker's expanded
-- breakdown row. Distinct from city_campaigns.dashboard_note which
-- applies to the whole city; this one is for "Friday crawl 1
-- specifically needs a backup wristband venue" style annotations.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN events.notes IS
  'Per-crawl operator note. Edited inline from the dashboard tracker''s expanded breakdown row. NULL = no note.';
