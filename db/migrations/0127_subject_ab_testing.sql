-- Subject-line A/B testing (Tier-2).
--
-- A cold template may carry 2+ subject variants. The composer picks one per
-- draft (deterministic, seeded by draft id -- reuses the spintax seed idea) so
-- the operator sees exactly what will send, then records which variant on the
-- draft and the send event. Variants are ranked by REPLY rate (inbound on the
-- thread) -- NO open pixels. Content choice only; deliverability-neutral.
--
-- IF NOT EXISTS keeps this safe to re-run.

-- The candidate subject lines for a template (raw subject-template strings,
-- each may contain merge fields). NULL / fewer than 2 = no A/B; the existing
-- subject_template is used as before.
ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS subject_variants jsonb;

-- The variant index chosen for this draft (into the template's subject_variants
-- array). NULL = not an A/B send.
ALTER TABLE email_drafts
  ADD COLUMN IF NOT EXISTS subject_variant_index integer;

-- The variant index that actually sent, mirrored onto the audit row so
-- analytics can group sends by subject variant without re-deriving. NULL for
-- non-A/B sends.
ALTER TABLE email_send_events
  ADD COLUMN IF NOT EXISTS subject_variant_index integer;
