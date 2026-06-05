-- Notification acknowledgment + escalation (Phase 4.6).
--
-- read_at already tracks "seen in the bell"; acknowledged_* is the stronger
-- "I've got this" used for cancellation alerts. escalate_after is when an
-- unacked alert should be bumped to the campaign manager (set by the
-- cancellation flow per urgency); escalated_at records that the cron did so.
-- acknowledged_by references users(id) (staff_members was renamed in 0041).
ALTER TABLE notifications
  ADD COLUMN acknowledged_at TIMESTAMPTZ,
  ADD COLUMN acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN escalate_after TIMESTAMPTZ,
  ADD COLUMN escalated_at TIMESTAMPTZ;

-- The escalation cron scans for due, unacked, not-yet-escalated alerts.
CREATE INDEX IF NOT EXISTS notifications_escalation_idx
  ON notifications (escalate_after)
  WHERE escalate_after IS NOT NULL AND acknowledged_at IS NULL AND escalated_at IS NULL;
