-- Slot-change reply flag (Phase 3.5). [ReferenceDoc 9.4]
--
-- When a CONFIRMED venue replies asking to move to a different day/slot, the
-- inbound poll worker runs lib/slot-change-detect (a pure phrase heuristic --
-- NOT a new AI reply_classification value) and raises this flag on the thread.
-- The /worklist "Slot change requested" section reads it; the operator then
-- drives the actual swap (cancel old slot, confirm the new one).
--
-- slot_change_requested:    heuristic says this thread probably wants a swap.
-- slot_change_detected_at:  when the detector first flagged it.
-- slot_change_phrase:       the change-intent phrase that matched, for display.
--
-- No FK columns added here (per CLAUDE.md section 6 the FKs already live on
-- email_threads.venue_id / city_campaign_id); these three are plain flags on
-- the existing row. IF NOT EXISTS keeps the migration safe to re-run.
ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS slot_change_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS slot_change_detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS slot_change_phrase text;

-- Partial index: the worklist loader only ever scans the flagged rows, which
-- are a tiny fraction of all threads. drizzle-kit cannot express partial
-- indexes, so (like 0094) this is hand-written here.
CREATE INDEX IF NOT EXISTS email_threads_slot_change_idx
  ON email_threads (last_inbound_at)
  WHERE slot_change_requested;
