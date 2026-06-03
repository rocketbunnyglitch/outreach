-- =========================================================================
-- 0092_campaign_scoped_templates.sql
--
-- Make email_templates campaign-scoped and code-addressable so the engine can
-- auto-pick the right template (T1-T17, H0a/H0b, V1) for a given context.
--
--   campaign_id        nullable FK; NULL = a global/brand template (legacy)
--   template_code      stable code (T1..T17; legacy_<stage> for existing rows)
--   trigger_context    JSONB describing when this template applies (Phase 1.1)
--   auto_pick_priority tiebreaker when several templates match (higher wins)
--
-- Uniqueness: (campaign_id, template_code) for campaign templates; for global
-- templates (campaign_id NULL) uniqueness is (outreach_brand_id, template_code).
--
-- Schema mirror: db/schema/templates.ts.
-- =========================================================================

ALTER TABLE email_templates
  ADD COLUMN campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  ADD COLUMN template_code TEXT,
  ADD COLUMN trigger_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN auto_pick_priority INTEGER NOT NULL DEFAULT 0;

-- Backfill existing (global) templates with a stable legacy code. stage is an
-- enum, so cast to text for concatenation.
UPDATE email_templates
SET template_code = 'legacy_' || stage::text
WHERE template_code IS NULL;

ALTER TABLE email_templates
  ALTER COLUMN template_code SET NOT NULL;

-- Campaign-scoped templates need a unique (campaign, code).
CREATE UNIQUE INDEX email_templates_campaign_code_unique
  ON email_templates(campaign_id, template_code)
  WHERE campaign_id IS NOT NULL;

-- Global (campaign-null) templates need a unique (brand, code).
CREATE UNIQUE INDEX email_templates_global_code_unique
  ON email_templates(outreach_brand_id, template_code)
  WHERE campaign_id IS NULL;

CREATE INDEX email_templates_campaign_idx ON email_templates(campaign_id);
CREATE INDEX email_templates_trigger_gin ON email_templates USING gin (trigger_context);
