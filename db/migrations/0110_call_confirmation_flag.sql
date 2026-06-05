-- Verbal-confirmation flag on call log entries.
--
-- Symmetric to the email written-confirmation flag (migration 0107). For
-- dispute defense, an operator can flag the specific logged CALL where a venue
-- verbally confirmed taking a slot. The venue detail card surfaces flagged
-- calls alongside flagged emails so the proof is one click away.
--
-- is_confirmation marks the call; the flagged_* columns record which operator
-- filed it + when. References users(id) (staff_members was renamed to users in
-- migration 0041).
ALTER TABLE outreach_log
  ADD COLUMN is_confirmation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN confirmation_flagged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN confirmation_flagged_at TIMESTAMPTZ;

-- Partial index: the venue card looks up "flagged confirmation calls for this
-- venue", so index venue_id only on the flagged rows.
CREATE INDEX IF NOT EXISTS outreach_log_is_confirmation_idx
  ON outreach_log (venue_id)
  WHERE is_confirmation;
