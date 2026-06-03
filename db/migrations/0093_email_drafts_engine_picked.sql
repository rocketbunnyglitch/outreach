-- =========================================================================
-- 0093_email_drafts_engine_picked.sql
--
-- Track which template the engine auto-picked when a composer was opened from
-- cold outreach / inbox reply (Phase 1.5). The operator can keep the pick or
-- override it via the template dropdown; comparing engine_picked_template_id
-- against the template actually sent gives us the override signal for the
-- misclassification-review surface later.
--
--   engine_picked_template_id  nullable FK -> email_templates(id)
--                              ON DELETE SET NULL (a deleted template must not
--                              cascade-delete or block an in-flight draft).
--
-- Distinct from email_drafts.template_id, which is the template currently
-- loaded into the composer (may have been swapped by the operator).
--
-- Schema mirror: db/schema/email-drafts.ts.
-- =========================================================================

ALTER TABLE email_drafts
  ADD COLUMN engine_picked_template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL;
