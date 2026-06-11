-- 0138: duplicate detection v2 (CRM plan D1, 2026-06-11).
--
-- Two pieces:
--
-- 1. venue_duplicate_decisions — every human ruling on a candidate
--    duplicate pair is recorded ONCE and remembered: 'not_duplicate'
--    and 'same_org' suppress future warnings for the pair; 'merged'
--    documents a merge. The pair is stored ordered (low uuid first)
--    so (A,B) and (B,A) are the same row.
--
-- 2. venues.merged_into_venue_id — when a venue is merged away, the
--    source row is archived and points at its survivor, so any reader
--    holding a stale reference can follow the chain. Outreach history
--    rows that could not be re-pointed (unique-constraint collisions)
--    stay on the archived source and remain reachable through it —
--    history is preserved, never deleted.
--
-- Expand-only: one new table + one nullable column.

CREATE TABLE IF NOT EXISTS venue_duplicate_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_low_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  venue_high_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  -- 'merged' | 'same_org' | 'not_duplicate'
  decision text NOT NULL,
  reason text,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_duplicate_decisions_pair_unique UNIQUE (venue_low_id, venue_high_id),
  CONSTRAINT venue_duplicate_decisions_ordered CHECK (venue_low_id < venue_high_id)
);

CREATE INDEX IF NOT EXISTS venue_duplicate_decisions_high_idx
  ON venue_duplicate_decisions (venue_high_id);

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS merged_into_venue_id uuid
    REFERENCES venues(id) ON DELETE SET NULL;
