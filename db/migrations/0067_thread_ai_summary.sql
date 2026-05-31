-- Phase A.3 — AI-generated thread summary.
--
-- Adds three columns to email_threads so long threads can be
-- summarized once and cached:
--
--   ai_summary                jsonb, NULL until summarized
--                              shape: { "headline": "...",
--                                       "context": "...",
--                                       "next": "..." }
--
--   ai_summary_at             timestamptz, when the summary was
--                              last generated
--
--   ai_summary_message_count  integer, the message_count at the
--                              time the summary was generated.
--                              Used as a cheap idempotency
--                              check — if the thread's
--                              message_count has grown since,
--                              the summary is stale and the
--                              page-load hook regenerates it.
--                              NULL when never summarized.
--
-- The page-load hook only fires the model when:
--   - thread.message_count >= 10
--   - ai_summary_message_count IS NULL OR < message_count
--
-- So a stable 12-message thread runs the model exactly once.
-- A growing thread re-summarizes when new messages arrive +
-- the operator opens it again.
--
-- Idempotent (IF NOT EXISTS). No backfill — summaries
-- materialize on first view.

ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS ai_summary jsonb,
  ADD COLUMN IF NOT EXISTS ai_summary_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_summary_message_count integer;
