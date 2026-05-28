-- Migration 0026 — Goals refactor per DECISIONS.md #025
--
-- Operator session 11 decision #025:
--   "Outreach goal = target_cities_scheduled + max_priority_for_scheduling
--    (visible to all outreach, NO $); admin goal = target_ticket_sales_count
--    (NOT cents, /admin/goals only). Drops revenue_goal_cents + venue_count_goal"
--
-- Adds three new integer columns to the campaigns table:
--
--   target_cities_scheduled       — outreach-team-facing: how many cities
--                                   should have crawls scheduled by end of
--                                   campaign window
--   max_priority_for_scheduling   — outreach-team-facing: cities with
--                                   priority <= this number must be scheduled
--                                   before lower-priority work
--   target_ticket_sales_count     — admin-only goal: total ticket sales
--                                   target across all cities in the campaign
--
-- All NULLABLE so existing rows don't break. Old columns (revenue_goal_cents
-- + venue_count_goal) are LEFT IN PLACE for now — dropping them is a
-- separate migration once all read sites are migrated.
--
-- Idempotent — IF NOT EXISTS guards re-runs.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS target_cities_scheduled INTEGER;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS max_priority_for_scheduling INTEGER;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS target_ticket_sales_count INTEGER;

-- No indexes — these are reference data, not search fields.
--
-- DEFERRED to a follow-up migration:
--   ALTER TABLE campaigns DROP COLUMN revenue_goal_cents;
--   ALTER TABLE campaigns DROP COLUMN venue_count_goal;
-- Reason: the existing form / read sites still reference these. We'll
-- drop them once the new goals UI is fully shipped + tested + the old
-- read sites are removed.
