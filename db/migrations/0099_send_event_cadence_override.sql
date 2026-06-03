-- =========================================================================
-- 0099_send_event_cadence_override.sql
--
-- Phase 1.9. Log admin overrides of the cadence floor / hard cap. When an
-- admin pushes a send through despite checkCadenceFloors blocking it, the
-- reason they gave is recorded here for the misclassification-review surface.
-- NULL = the send was within the floors (no override).
--
-- (Spec called this migration 0095; renumbered to 0099 -- 0093-0098 are taken.
-- See the Reconciliation Addendum in docs/engine-build-spec-phased.md.)
--
-- Schema mirror: db/schema/email-send-events.ts.
-- =========================================================================

ALTER TABLE email_send_events
  ADD COLUMN cadence_override_reason TEXT;
