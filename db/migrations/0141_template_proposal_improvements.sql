-- 0141_template_proposal_improvements.sql
--
-- Extend the template-proposal engine so it can ALSO propose IMPROVEMENTS to an
-- existing template (when staff replies consistently outperform what the
-- template drafts), not just brand-new templates. Promote of an improvement
-- updates the target template in place (version-bumped); promote of a 'new'
-- creates a fresh template. Expand-only (additive nullable/defaulted columns).

ALTER TABLE template_proposals
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'new', -- new | improvement
  ADD COLUMN IF NOT EXISTS target_template_code text,
  ADD COLUMN IF NOT EXISTS target_template_id uuid
    REFERENCES email_templates(id) ON DELETE SET NULL;
