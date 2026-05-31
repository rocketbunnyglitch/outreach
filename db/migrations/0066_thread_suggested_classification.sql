-- Phase A.1 — AI-suggested classification on inbound.
--
-- Adds three columns to email_threads so the ingest-time AI
-- classifier can record its guess without overwriting any
-- operator-set classification:
--
--   suggested_classification             reply_classification enum,
--                                         nullable (NULL = AI hasn't
--                                         classified yet)
--   suggested_classification_confidence  numeric(4,3), 0..1, NULL
--                                         until classified
--   suggested_classification_at          timestamptz, when the AI
--                                         last classified
--
-- The existing `classification` column stays the source of truth
-- for the operator-confirmed value. The UI surfaces the suggestion
-- next to the unclassified pill so operators can one-click confirm
-- or override. After operator action, `classification` is set and
-- `suggested_classification` is cleared (so the pill stops
-- showing).
--
-- Idempotent (IF NOT EXISTS). No backfill — existing threads get
-- classified on their next inbound message, or via the manual
-- classify button.

ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS suggested_classification reply_classification,
  ADD COLUMN IF NOT EXISTS suggested_classification_confidence numeric(4,3),
  ADD COLUMN IF NOT EXISTS suggested_classification_at timestamptz;

-- Partial index — only rows that actually carry a suggestion (the
-- vast majority of threads either don't have one yet, or have had
-- it cleared by operator confirmation). Keeps the index small +
-- the dashboard's "AI suggested · unconfirmed" filter fast.
CREATE INDEX IF NOT EXISTS email_threads_suggested_classification_idx
  ON email_threads (suggested_classification, suggested_classification_at DESC)
  WHERE suggested_classification IS NOT NULL;
