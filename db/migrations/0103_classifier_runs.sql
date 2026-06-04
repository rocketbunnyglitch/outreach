-- Phase 1.13: classifier_runs -- one row per AI inbound-classification run.
-- Captures which reference-doc sections were retrieved to ground the prompt,
-- the model's output (classification + confidence), and the model id, so we can
-- audit that Reference Doc rules drive the classifier and compare versions over
-- time. Append-only.
--
-- Schema mirror: db/schema/classifier-runs.ts (exported from db/schema/index.ts).
CREATE TABLE classifier_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  retrieved_section_codes TEXT[] NOT NULL,
  classification reply_classification NOT NULL,
  confidence NUMERIC(4,3) NOT NULL,
  model TEXT NOT NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX classifier_runs_thread_idx ON classifier_runs(thread_id, run_at);
CREATE INDEX classifier_runs_message_idx ON classifier_runs(message_id);
