-- Temporary in-crawl disable for a confirmed middle venue.
--
-- During a live crawl a middle venue sometimes backs out last-minute. The
-- operator flips temporarily_disabled so the slot reopens in the outreach
-- slot lists WITHOUT losing the booking; Restore flips it back (the owner
-- often steps in and resolves it). Middle role only -- wristband/final slots
-- are too central and get fully replaced instead.
--
-- flagged_* columns record who disabled it + when. References users(id)
-- (staff_members was renamed to users in migration 0041).
ALTER TABLE venue_events
  ADD COLUMN temporarily_disabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN temporarily_disabled_at TIMESTAMPTZ,
  ADD COLUMN temporarily_disabled_by UUID REFERENCES users(id) ON DELETE SET NULL;
