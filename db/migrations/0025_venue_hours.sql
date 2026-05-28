-- Migration 0025 — Add venues.hours
--
-- Operator session 11 carryover (call follow-up engine):
--   "Venue-hours-aware suggested call window — needs new venue.hours
--    column add"
--
-- Adds a free-text 'hours' column to the venues table so operators can
-- paste opening hours from Google Maps. v1 stores raw text only; a
-- future commit will add a parser that derives a "best call window"
-- (typically 1-2 hours before the venue's opening time, when the
-- manager is on-site but not slammed).
--
-- Why text not jsonb (yet)
-- ------------------------
-- 99% of operator entry is copy-paste from Google Maps, which formats
-- hours as multi-line text. Forcing structured entry upfront would slow
-- venue setup massively. The text column is the source of truth; a
-- best-effort parser in the app layer can derive structure later.
--
-- A subsequent migration may add hours_parsed (jsonb) to cache the
-- parsed structure once the parser stabilizes. Keeping that separate
-- means the text column stays editable without invalidating cached
-- structure.
--
-- Idempotent — IF NOT EXISTS guards re-runs.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS hours TEXT;

-- No index — hours is reference data, not a search field.
