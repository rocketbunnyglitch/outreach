-- Written-confirmation flag on emails.
--
-- For dispute defense ("the venue says we never agreed to this"), an operator
-- can flag the specific email where a venue confirmed taking a slot. The venue
-- detail card surfaces flagged confirmations prominently -- who at the venue,
-- when, and the message itself -- so the proof is one click away.
--
-- is_confirmation marks the message; the flagged_* columns record which
-- operator filed it + when. References users(id) (staff_members was renamed to
-- users in migration 0041).
ALTER TABLE email_messages
  ADD COLUMN is_confirmation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN confirmation_flagged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN confirmation_flagged_at TIMESTAMPTZ;

-- Partial index: the venue card looks up "flagged confirmation messages for
-- these threads", so index thread_id only on the flagged rows.
CREATE INDEX IF NOT EXISTS email_messages_is_confirmation_idx
  ON email_messages (thread_id)
  WHERE is_confirmation;
