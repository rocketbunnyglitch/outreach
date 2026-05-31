-- AI smart-reply chips cache (Tier S #1 — Haiku ROI sprint).
--
-- Adds three columns to email_threads so the inbox thread page can
-- show 3 one-tap quick-reply chips above the reply buttons without
-- re-firing Haiku on every page load.
--
--   ai_quick_replies                jsonb, NULL until generated.
--                                    Shape: a JSON array of exactly
--                                    3 short reply strings.
--                                      [
--                                        "Thanks — sending pricing now",
--                                        "Tuesday 2pm works for a call",
--                                        "Appreciate the note, sadly not a fit"
--                                      ]
--                                    Each ≤ 280 chars; the model is
--                                    prompted to keep them mobile-tappable.
--
--   ai_quick_replies_at             timestamptz, when the chips were
--                                    last generated. NULL = never.
--
--   ai_quick_replies_message_count  integer, the message_count at the
--                                    time the chips were generated.
--                                    The page-load hook regenerates
--                                    when this is stale:
--                                      thread.message_count > ai_quick_replies_message_count
--                                    So a stable thread runs the model
--                                    exactly once; a growing thread
--                                    regenerates when a new inbound
--                                    lands and the operator re-opens.
--
-- Generation gates (see lib/ai-quick-replies.ts):
--   - thread has at least one inbound message
--   - latest message is inbound (no point suggesting replies to a
--     thread the operator just sent into)
--   - classification is one of: interested, warm, confirmed, question,
--     callback_requested. decline/unsubscribe/spam/auto_reply skip
--     suggestions — those threads don't need a reply.
--   - AI_QUICK_REPLIES_ENABLED env flag is not set to "0"
--   - cooperative per-staff rate limit (lib/ai-guardrails.ts)
--
-- Idempotent (IF NOT EXISTS). No backfill — chips materialize on
-- first view of qualifying threads.

ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS ai_quick_replies jsonb,
  ADD COLUMN IF NOT EXISTS ai_quick_replies_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_quick_replies_message_count integer;
