-- 0135: autonomy rails (operator request 2026-06-11 — "program now so
-- we can be set to go this route eventually once we gather evidence").
--
-- The trust ladder: every engine proposal gets a recorded human
-- verdict (action_verdicts); per-action-type policies (autonomy_policies)
-- hold the CURRENT rung — suggest / review_window / auto. Graduation is
-- ALWAYS a human flipping the policy on /admin/autonomy, informed by
-- measured agreement rates; the engine never grants itself autonomy,
-- and actual autonomous dispatch additionally requires a server env
-- flag that is not set. Today every policy is 'suggest' — identical
-- behavior to before this migration; only the evidence starts
-- accumulating.
--
-- Expand-only: two new tables, nothing else touched.

CREATE TABLE IF NOT EXISTS action_verdicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'classify_reply' | 'quick_reply_chip' | 'template_pick' | 'cold_nudge'
  action_type text NOT NULL,
  -- 'accepted' (used as-is) | 'edited' (used with changes) | 'rejected'
  verdict text NOT NULL,
  -- The thread/draft/entry the proposal was about (loose uuid on purpose).
  subject_id uuid,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_verdicts_type_time_idx
  ON action_verdicts (action_type, created_at DESC);

CREATE TABLE IF NOT EXISTS autonomy_policies (
  action_type text PRIMARY KEY,
  -- 'suggest' (engine proposes, human executes — today's behavior)
  -- 'review_window' (engine may queue, human has a veto window) — NOT
  --   yet wired to dispatch; rails only
  -- 'auto' (engine acts and reports) — NOT yet wired to dispatch
  mode text NOT NULL DEFAULT 'suggest',
  review_window_minutes integer NOT NULL DEFAULT 120,
  notes text,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO autonomy_policies (action_type, notes) VALUES
  ('classify_reply',   'AI reply classification vs operator confirm/override'),
  ('quick_reply_chip', 'Suggested reply chips vs sent-as-is/edited/rewritten'),
  ('template_pick',    'Engine template pick vs the template actually sent'),
  ('cold_nudge',       'Mechanical cadence nudges (T2/T7) — future review-window candidate')
ON CONFLICT (action_type) DO NOTHING;
