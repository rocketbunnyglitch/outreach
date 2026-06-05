-- V2 floor-staff briefing-call tracking (Phase 3.13). [ReferenceDoc 7.14.3a]
--
-- EXTENDS the existing venue_events.floor_staff_call_completed_at (which is the
-- "floor staff briefed" marker -- do NOT duplicate it) with attempt history so
-- the host-manager worklist can show "Attempts: N, last: <outcome> <when>".
--
-- last_call_outcome values:
--   'confirmed_with_floor_staff' | 'manager_again_partial'
--   | 'no_answer' | 'voicemail' | 'issue_raised'
ALTER TABLE venue_events
  ADD COLUMN floor_staff_call_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN floor_staff_last_call_at TIMESTAMPTZ,
  ADD COLUMN floor_staff_last_call_outcome TEXT;
