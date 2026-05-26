-- =========================================================================
-- 0016_viber_line_on_brand.sql
--
-- The 2-3 outreach staff share one Viber account used to reach venues in
-- countries Quo doesn't service well (Philippines, parts of MENA, Eastern
-- Europe). Store the shared Viber number per outreach_brand for:
--   • Display reference in the brand settings / audit log
--   • Future automation (Viber Business API, if/when needed)
--
-- The deep-link from each cold-outreach row (viber://chat?number=...)
-- doesn't need this column — Viber on the device routes from whichever
-- account is logged in. The column exists as the operational record of
-- which number the team is dialing FROM.
-- =========================================================================

ALTER TABLE outreach_brands
  ADD COLUMN IF NOT EXISTS viber_line_e164 text;

COMMENT ON COLUMN outreach_brands.viber_line_e164 IS
  'Shared Viber account E.164 number used by the outreach team. Display
   reference; the deep-link UI opens whatever Viber is logged in locally.';
