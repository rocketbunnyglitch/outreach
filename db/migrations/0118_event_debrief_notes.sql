-- Operator post-event debrief notes (Phase 6.4).
--
-- A single free-text debrief per event (the crawl night), written after the
-- event runs: what went well, what broke, venue follow-ups for next time. This
-- is a single editable field on the event record (NOT the author-attributed
-- polymorphic notes table) -- one running debrief the operator edits in place,
-- last-writer-wins, with who/when stamped for accountability.
--
-- Lives on events (the crawl night) rather than venue_events: a debrief is
-- about how the whole crawl went, not a per-venue booking. Per-venue context
-- still goes in venues.internal_notes or the notes table.
ALTER TABLE events ADD COLUMN IF NOT EXISTS debrief_notes text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS debrief_updated_at timestamptz;
ALTER TABLE events ADD COLUMN IF NOT EXISTS debrief_updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
