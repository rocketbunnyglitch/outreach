-- =========================================================================
-- 0010_dashboard_inline_fields.sql
--
-- Per spec: the main tracker dashboard has inline-editable Assign +
-- Notes columns per (city, campaign). Assign maps to existing
-- city_campaigns.lead_staff_id. Notes is a new short free-text field
-- separate from polymorphic notes (which are author-attributed and
-- longer-form).
--
-- dashboard_note is intended for one-liner "JC chasing 2-week confirm"
-- kind of context, edited inline by any operator, no history.
-- =========================================================================

ALTER TABLE city_campaigns
  ADD COLUMN IF NOT EXISTS dashboard_note text;
