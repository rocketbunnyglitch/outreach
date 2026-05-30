-- 0051_follow_up_cadence.sql
--
-- Follow-up cadence automation: the daily cadence engine writes
-- to these columns + creates auto-tasks linked to threads. Two
-- additions:
--
--   1. email_threads gets columns tracking what cadence stage the
--      thread is at + when the next cadence check should fire.
--   2. task_target_type enum gains 'email_thread' so auto-created
--      follow-up tasks point at the thread, not at a venue.
--
-- Why columns on email_threads instead of a separate cadence_events
-- table:
--   - There's exactly one cadence state per thread (stage + when).
--     A second table would be a 1-1 join with no benefit.
--   - The cadence engine reads + writes both together; co-located
--     is simpler.
--   - The stale-tagger (0050) and inbox queries already select
--     from email_threads; adding columns there means one fewer JOIN.
--
-- Cadence rules (v1, configurable in lib/follow-up-cadence.ts):
--   stage 0 (initial cold send)
--     -> 4 days no reply  → state becomes follow_up_due, stage = 1
--     -> 7 days no reply  → create auto-task "Call venue", stage = 2
--   stage 2 (call task created)
--     -> terminal until operator action
--
-- Setting state -> follow_up_due is the OPERATIONAL signal; the
-- task is for the more aggressive "they're really not replying"
-- step.

-- =========================================================================
-- email_threads cadence columns
-- =========================================================================

-- 0 = initial cold send (default for any thread that started outbound)
-- 1 = first follow-up due (state has been flipped to follow_up_due)
-- 2 = call task created (operator should phone)
-- We don't use a pgEnum here because the value range is small and
-- numeric ordering is meaningful for the cron's "advance one stage"
-- logic.
ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS follow_up_stage smallint NOT NULL DEFAULT 0;

-- When the NEXT cadence step should fire for this thread. NULL =
-- no pending cadence (e.g. thread has an inbound reply, or the
-- cadence reached its terminal stage). The cadence engine scans
-- threads with follow_up_next_due_at <= NOW() AND state IN open
-- states.
ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS follow_up_next_due_at timestamptz;

-- When the last cadence advance happened (for audit / debugging
-- "why didn't this fire today" questions).
ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS follow_up_last_advanced_at timestamptz;

-- Partial index: only the threads with a due-soon cadence get
-- indexed. The cadence cron's filter is exactly this predicate.
CREATE INDEX IF NOT EXISTS email_threads_follow_up_due_idx
  ON email_threads (follow_up_next_due_at)
  WHERE follow_up_next_due_at IS NOT NULL;

COMMENT ON COLUMN email_threads.follow_up_stage IS
  'Cadence stage. 0=initial cold send, 1=follow_up_due flipped, 2=call task created. Reset to 0 when operator replies/state changes.';
