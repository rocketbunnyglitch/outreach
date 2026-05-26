-- =========================================================================
-- 0004_pg_trgm.sql
--
-- Adds the pg_trgm extension for fuzzy text matching. Used for venue
-- duplicate detection: when an operator types a new venue name + address,
-- we want to surface any existing venues with similar names, even if not
-- exactly typed the same ("The Drake" vs "Drake Hotel" vs "Drake").
--
-- pg_trgm provides:
--   * similarity(text, text) → 0..1 float
--   * % operator → "trigram similar" boolean
--   * GIN/GiST indexes for fast similarity lookup
--
-- We also add a similarity index on venues.name so the duplicate check
-- stays fast (without it, every check is a full table scan).
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index for fast similarity search on venue names.
-- A trigram index can answer queries like:
--   SELECT * FROM venues WHERE name % 'drake hotel';
-- in O(log n) instead of O(n).
CREATE INDEX IF NOT EXISTS venues_name_trgm_idx
  ON venues USING gin (name gin_trgm_ops);

-- Same for venue address since duplicates often share the address line
-- even when the names differ slightly.
CREATE INDEX IF NOT EXISTS venues_address_trgm_idx
  ON venues USING gin (address gin_trgm_ops);
