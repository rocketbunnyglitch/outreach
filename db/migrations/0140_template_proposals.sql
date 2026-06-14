-- 0140_template_proposals.sql
--
-- Template-proposal engine: the missing bridge from "rank/suggest existing
-- templates" to "evolve the template library". An AI pass mines high-performing
-- staff replies (confirmed outcome, accepted-heavy) that no existing template
-- covers, and drafts candidate templates. The engine PROPOSES; the operator
-- reviews on /admin/learning and promotes (creates a real email_template) or
-- dismisses. Expand-only (new table; no reads/writes of existing shapes).

CREATE TABLE IF NOT EXISTS template_proposals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  title text NOT NULL,
  suggested_subject text NOT NULL DEFAULT '',
  suggested_body text NOT NULL,
  rationale text NOT NULL DEFAULT '',
  -- reply_examples.reply_message_id values that support this proposal.
  example_message_ids uuid[] NOT NULL DEFAULT '{}',
  support_count integer NOT NULL DEFAULT 0,
  confirmed_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- pending | promoted | dismissed
  -- normalized title, so re-running the generator can't pile duplicate
  -- proposals of the same intent on top of each other.
  dedupe_key text NOT NULL,
  promoted_template_id uuid REFERENCES email_templates(id) ON DELETE SET NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL
);

-- One LIVE (pending/promoted) proposal per (campaign, intent). Dismissed ones
-- don't block — if the operator said no but the pattern keeps recurring, a
-- later run can resurface it.
CREATE UNIQUE INDEX IF NOT EXISTS template_proposals_campaign_dedupe_live
  ON template_proposals (campaign_id, dedupe_key)
  WHERE status IN ('pending', 'promoted');

CREATE INDEX IF NOT EXISTS template_proposals_status_idx
  ON template_proposals (status, created_at DESC);
