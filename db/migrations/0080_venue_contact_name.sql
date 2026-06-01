-- Venue primary contact name.
--
-- Operator-provided contact for each venue (the owner / manager /
-- main person we work with). Distinct from venue_events.night_of_contact_name
-- which is the bar-side person for a SPECIFIC event slot — that
-- field tracks per-night staff who may differ from the main
-- relationship contact.
--
-- This column is populated by:
--   1. The xlsx imports — venue-resolver writes contact_name from
--      the source row when the venue field is currently NULL
--   2. Manual edits on the venue detail page
--
-- Most-recent-campaign wins for backfill, but operator manual edits
-- (tracked via auditColumns.updatedBy) are NEVER overwritten by
-- subsequent imports.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS contact_name text;
