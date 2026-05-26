-- =========================================================================
-- 0007_outreach_phase.sql
--
-- Phased rollout of the outreach engine, per the user's spec:
--
--   Phase 1 — Draft-assist mode
--     Engine generates emails. Staff reviews + sends manually (mailto:)
--     or via the API. Throttle still enforced (cap is the spam-safe
--     ceiling).
--
--   Phase 2 — Controlled send mode
--     Staff selects 20-40 approved venues. Engine spaces sends through
--     the day automatically. Throttle + warm-up apply.
--
--   Phase 3 — Automated follow-up mode
--     Only follow-ups are automated. They stop on reply, bounce,
--     unsubscribe, or decline. Cold first-touch still Phase 1/2.
--
--   Phase 4 — Full automation for confirmed/warm/transactional
--     Posters, reminders, staff sheets, and confirmations send
--     automatically. Cold sends still gated on the lower phases.
--
-- The phase is a PER-BRAND setting. A team can run Phase 4 on
-- 'Eventsperse' (mature, proven deliverability) while keeping a newer
-- brand at Phase 1.
--
-- Higher phases imply the lower phases — Phase 3 doesn't disable
-- Phase 1's draft-assist; it adds automated follow-ups on top.
-- =========================================================================

ALTER TABLE outreach_brands
  ADD COLUMN IF NOT EXISTS outreach_phase smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS outreach_phase_set_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS outreach_phase_set_by uuid;

ALTER TABLE outreach_brands
  ADD CONSTRAINT outreach_brands_phase_check
    CHECK (outreach_phase BETWEEN 1 AND 4);
