-- =========================================================================
-- 0096_external_host_brief_fields.sql
--
-- Host-brief merge fields (merge-field fix). The host briefing templates
-- (H0a hire-time, H0b week-of) merge a host's manager contact + shift timing,
-- which had no home in the schema. Per the operator, these live on the
-- external host record. All are free text so international hosts can store
-- whatever format reads naturally in the email ("8 PM", "doors 7:30").
--
--   host_manager_name   the manager/lead the host coordinates with
--   host_manager_phone  that manager's phone
--   host_arrival_time   when the host should arrive
--   shift_start_time    shift start
--   shift_end_time      shift end
--
-- Schema mirror: db/schema/external-hosts.ts.
-- =========================================================================

ALTER TABLE external_hosts
  ADD COLUMN host_manager_name TEXT,
  ADD COLUMN host_manager_phone TEXT,
  ADD COLUMN host_arrival_time TEXT,
  ADD COLUMN shift_start_time TEXT,
  ADD COLUMN shift_end_time TEXT;
