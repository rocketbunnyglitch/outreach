-- =========================================================================
-- 0015_outreach_channel_viber.sql
--
-- Add 'viber' to the outreach_channel enum.
--
-- Viber is used by outreach staff to reach venues in countries Quo can't
-- service well (Philippines, parts of MENA, Eastern Europe). It's not an
-- API-driven channel — staff use the Viber app on their device — but we
-- still want every touch tracked in outreach_log so per-staff analytics
-- aren't missing this work.
--
-- ALTER TYPE … ADD VALUE is idempotent via IF NOT EXISTS (Postgres 12+).
-- =========================================================================

ALTER TYPE outreach_channel ADD VALUE IF NOT EXISTS 'viber';
