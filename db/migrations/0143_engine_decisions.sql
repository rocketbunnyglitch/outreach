-- 0143_engine_decisions.sql
--
-- The shadow ledger (autonomy roadmap Phase A). For every draft the engine
-- authors autonomously, record what it chose + how confident it was; when the
-- human acts on that draft, record what they did. Agreement over time, per touch
-- class, is the EVIDENCE that earns a class the right to auto-send (Phase D) —
-- autonomy is granted on measured data, never a guess. Expand-only.

CREATE TABLE IF NOT EXISTS engine_decisions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  draft_id uuid REFERENCES email_drafts(id) ON DELETE SET NULL,
  thread_id uuid,
  venue_id uuid,
  campaign_id uuid,
  decision_kind text NOT NULL,          -- cold_touch | lifecycle | reply | other
  template_code text,
  confidence integer NOT NULL DEFAULT 0, -- 0..100
  confidence_factors jsonb,
  engine_body_len integer,              -- to estimate how much the human edited
  outcome text NOT NULL DEFAULT 'pending', -- pending | sent_unchanged | sent_edited | discarded
  agreement numeric(4,3),               -- 0..1: how closely the human matched the engine
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS engine_decisions_kind_created_idx
  ON engine_decisions (decision_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS engine_decisions_draft_idx ON engine_decisions (draft_id);
