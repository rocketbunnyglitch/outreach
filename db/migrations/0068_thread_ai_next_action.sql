-- Phase A.4 — AI-enriched next-action suggestion.
--
-- Adds three columns to email_threads so the rule-based
-- suggestNextAction can be augmented with a richer, context-
-- aware recommendation for ambiguous cases (interested / warm /
-- confirmed / question / callback_requested).
--
--   ai_next_action                jsonb, NULL until generated
--                                  shape: { "label": "...",
--                                           "reason": "...",
--                                           "urgency": "now"|"today"|...,
--                                           "generatedAt": "...",
--                                           "classification": "..." }
--
--   ai_next_action_at             timestamptz, last generated
--
--   ai_next_action_message_count  integer, the message_count at
--                                  the time of generation +
--                                  classification fingerprint
--                                  baked into the JSON payload.
--                                  Used as a cheap idempotency
--                                  check.
--
-- Cache invalidation: page-load hook regenerates when
--   ai_next_action_message_count IS NULL
--   OR ai_next_action_message_count < message_count
--   OR cached_payload.classification != current classification
--
-- Idempotent. No backfill — suggestions materialize lazily.

ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS ai_next_action jsonb,
  ADD COLUMN IF NOT EXISTS ai_next_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_next_action_message_count integer;
