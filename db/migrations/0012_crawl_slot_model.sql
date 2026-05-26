-- =========================================================================
-- 0012_crawl_slot_model.sql
--
-- Per spec: the city sheet shows a per-crawl table with 4 default slots:
--   Wristband · Middle 1 · Middle 2 · Final
--
-- Slots map 1:1 to venue_events rows for the crawl (the event). The
-- existing model has venue_events.role enum (wristband|middle|final)
-- but no slot ordering — so two middle venues couldn't be distinguished
-- as "Middle 1" vs "Middle 2".
--
-- This migration:
--   1. Extends venue_role enum with 'alt_final' (backup/alternative
--      final venue option per the spec)
--   2. Adds venue_events.slot_position smallint — 1-indexed ordering
--      within a (event_id, role) group. NULL allowed for legacy rows.
--   3. Indexes (event_id, role, slot_position) for fast slot lookups.
--
-- IMPORTANT: ADD VALUE TO ENUM must run outside a transaction in pg.
-- The migration harness wraps the file in BEGIN…COMMIT, so we use
-- IF NOT EXISTS so each statement is idempotent + the harness's
-- transactional wrapping is safe.
-- =========================================================================

-- 1. Extend venue_role enum
ALTER TYPE venue_role ADD VALUE IF NOT EXISTS 'alt_final';

-- 2. slot_position on venue_events
ALTER TABLE venue_events
  ADD COLUMN IF NOT EXISTS slot_position smallint;

-- Backfill: assign slot_position=1 to existing rows with NULL.
-- Per (event_id, role) we use ROW_NUMBER over created_at to assign
-- stable positions for rows that share role within an event.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY event_id, role
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM venue_events
  WHERE slot_position IS NULL
)
UPDATE venue_events ve
SET slot_position = ranked.rn
FROM ranked
WHERE ve.id = ranked.id;

-- 3. Index for slot lookups in city sheet
CREATE INDEX IF NOT EXISTS venue_events_event_role_position_idx
  ON venue_events(event_id, role, slot_position);

-- 4. Unique guard — at most one venue per (event, role, slot_position).
--    A venue can occupy multiple slot positions across different events
--    (e.g. middle in Friday Crawl 1 and Crawl 2) — that's enforced at
--    app layer via the shared middle group concept.
CREATE UNIQUE INDEX IF NOT EXISTS venue_events_event_role_position_unique
  ON venue_events(event_id, role, slot_position)
  WHERE slot_position IS NOT NULL;
