-- 0134: the learning loop (operator request 2026-06-11 — "build a
-- database to help better autoclassify emails and suggest replies").
--
-- Two example stores mined nightly from real email history:
--   reply_examples           inbound venue message -> the reply an
--                            operator actually sent, with the eventual
--                            outcome (confirmed/declined/ghosted) and
--                            quality counters fed by composer feedback.
--   classification_examples  inbound message -> the classification a
--                            human confirmed. Few-shot fuel for
--                            lib/ai-classify.
--
-- Plus email_drafts.suggestion_meta: when a draft is seeded from an
-- AI suggestion, this records which corpus examples backed it so the
-- send path can credit/penalize them (sent-as-is vs rewritten).
--
-- Expand-only per the migration policy: new tables + one nullable
-- column; nothing dropped, renamed, or narrowed.

CREATE TABLE IF NOT EXISTS reply_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES email_threads(id) ON DELETE CASCADE,
  inbound_message_id uuid UNIQUE REFERENCES email_messages(id) ON DELETE CASCADE,
  reply_message_id uuid REFERENCES email_messages(id) ON DELETE CASCADE,
  inbound_text text NOT NULL,
  reply_text text NOT NULL,
  replied_at timestamptz,
  classification text,
  template_code text,
  sender_inbox text,
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  city_name text,
  city_priority smallint,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  -- 'pending' until the nightly labeler sees what happened next.
  outcome text NOT NULL DEFAULT 'pending',
  outcome_at timestamptz,
  -- Composer feedback (suggestion quality re-ranking).
  accepted_count integer NOT NULL DEFAULT 0,
  edited_count integer NOT NULL DEFAULT 0,
  rewritten_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', inbound_text)) STORED
);

CREATE INDEX IF NOT EXISTS reply_examples_tsv_idx ON reply_examples USING gin (search_tsv);
CREATE INDEX IF NOT EXISTS reply_examples_outcome_idx ON reply_examples (outcome);
CREATE INDEX IF NOT EXISTS reply_examples_inbox_idx ON reply_examples (sender_inbox);

CREATE TABLE IF NOT EXISTS classification_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid UNIQUE REFERENCES email_messages(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES email_threads(id) ON DELETE CASCADE,
  text text NOT NULL,
  final_label text NOT NULL,
  was_override boolean NOT NULL DEFAULT false,
  confidence numeric(4,3),
  created_at timestamptz NOT NULL DEFAULT now(),
  search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);

CREATE INDEX IF NOT EXISTS classification_examples_tsv_idx
  ON classification_examples USING gin (search_tsv);
CREATE INDEX IF NOT EXISTS classification_examples_label_idx
  ON classification_examples (final_label);

ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS suggestion_meta jsonb;
