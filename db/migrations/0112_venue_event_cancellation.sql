-- Cancellation tracking on venue_events (Phase 4.1).
--
-- The status enum already has 'cancelled'; these columns record WHEN, WHY, and
-- by WHOM so the cancellation flow can stop downstream touches, draft T16, and
-- surface a cancelled-venues view. References users(id) (staff_members was
-- renamed to users in migration 0041).
ALTER TABLE venue_events
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancellation_reason TEXT,
  ADD COLUMN cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- The cancelled-venues view (Phase 4.7) lists cancellations newest-first.
CREATE INDEX IF NOT EXISTS venue_events_cancelled_at_idx
  ON venue_events (cancelled_at)
  WHERE cancelled_at IS NOT NULL;
