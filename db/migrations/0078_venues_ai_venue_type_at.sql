-- AI venue type auto-tag (Haiku ROI #8).
--
-- Adds a single timestamp column to venues so the backfill can
-- distinguish "never tagged" from "tagged on date X" — used by
-- the rescore-after-N-days logic in lib/ai-venue-type-tag.ts.
--
-- We DON'T add a separate ai_venue_type column. The existing
-- venue_type text[] is the source of truth; AI just populates
-- empty arrays. Operator edits are still authoritative — the
-- backfill skips any venue that already has a non-empty
-- venue_type, so manual tags are never overwritten.
--
--   ai_venue_type_at   timestamptz NULL — when the backfill last
--                       wrote a tag. NULL = never tagged. Used
--                       to skip re-tagging recently-processed
--                       venues during a chained backfill, and to
--                       audit "what did AI populate."
--
-- Idempotent (IF NOT EXISTS). No backfill — tags materialize
-- when the admin runs the backfill action OR when a new venue
-- is created without a venueType.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS ai_venue_type_at timestamptz;

-- Partial index for the backfill query — "venues with empty type
-- arrays" is the hot path. The text[] cardinality check is cheap
-- but a partial index keeps the scan tight as venues grow.
CREATE INDEX IF NOT EXISTS venues_empty_venue_type_idx
  ON venues (city_id)
  WHERE cardinality(venue_type) = 0;
