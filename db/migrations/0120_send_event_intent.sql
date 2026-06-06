-- Explicit send intent on email_send_events (P0 -- "every send has an intent").
--
-- Records the classified send intent + touch code on every send-event audit
-- row so "was this treated as cold outreach?" is answerable directly, and a
-- lifecycle / cancellation / post-event send can be proven NOT to have
-- consumed the cold budget or seeded cold cadence. See lib/send-intent.ts
-- (deriveSendIntent) + lib/compose-send-impl.ts.
--
-- Additive + nullable: legacy rows stay NULL. The cap/cadence behavior
-- booleans (cadence_managed, applied_cadence_floor, recorded_cadence_touch)
-- are all deterministically derivable from send_intent, so we store the
-- single source value rather than denormalizing each flag.

ALTER TABLE email_send_events
  ADD COLUMN IF NOT EXISTS send_intent TEXT,
  ADD COLUMN IF NOT EXISTS touch_type TEXT;

CREATE INDEX IF NOT EXISTS email_send_events_send_intent_idx
  ON email_send_events (send_intent, sent_at);
