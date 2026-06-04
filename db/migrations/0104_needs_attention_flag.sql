-- Phase 1.14: needs_attention -- a per-thread human-triage flag, distinct from
-- is_stale (SLA staleness). The auto-classifier sets it true when it lands below
-- the Reference Doc 8.4 confidence floor (act only at >=90% confidence); later
-- (Phase 2.9) it will also flag when the engine cannot produce a suggested
-- response. The worklist (Phase 2) surfaces flagged threads first; the operator
-- clears the flag on triage.
--
-- Partial index keeps the worklist's "needs_attention = true" scan cheap.
-- Schema mirror: db/schema/outreach.ts (emailThreads.needsAttention).
ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS needs_attention boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS email_threads_needs_attention_idx
  ON email_threads(needs_attention) WHERE needs_attention;
