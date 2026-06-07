-- Full send-intent audit on email_send_events (P0 acceptance #7).
--
-- Complements 0120 (send_intent + touch_type) so a send-event row is entirely
-- self-describing for "was this treated as cold outreach, and what cadence
-- effects did it have?" without re-deriving from send_intent. These mirror the
-- classified intent (lib/send-intent.ts) at send time:
--   cadence_managed        -> the send participates in the cold/warm cadence
--   applied_cadence_floor  -> the cadence floor was enforced for it
--   recorded_cadence_touch -> the classifier allowed a venue_campaign_touch_log
--                             touch (the thread's cadence_state still gates the
--                             actual write)
-- venue_event_id ties the send to a specific night for multi-night venues.
-- All additive + nullable; legacy rows stay NULL.

ALTER TABLE email_send_events
  ADD COLUMN IF NOT EXISTS venue_event_id UUID REFERENCES venue_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cadence_managed BOOLEAN,
  ADD COLUMN IF NOT EXISTS applied_cadence_floor BOOLEAN,
  ADD COLUMN IF NOT EXISTS recorded_cadence_touch BOOLEAN;

CREATE INDEX IF NOT EXISTS email_send_events_venue_event_idx
  ON email_send_events (venue_event_id);
