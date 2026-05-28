-- Migration 0035 — Per-crawl internal-host capture on crawl_hosts
--
-- Operator: the internal-host details should live on the crawl event, not the
-- shared internal_hosts roster, "cause there could be a different internal host
-- on a different crawl or day that works different hours."
--
-- So host_type='internal' crawls can now capture the name + hours + hourly rate
-- inline on the crawl_hosts row. internal_host_id stays optional (a link to the
-- roster for payout). For host_type='external', external_host_id may be NULL
-- while the crawl awaits assignment on the /external-hosts page.
--
-- All three columns are nullable; no backfill needed. Idempotent.

ALTER TABLE crawl_hosts
  ADD COLUMN IF NOT EXISTS internal_host_name text,
  ADD COLUMN IF NOT EXISTS internal_host_hours numeric(6, 2),
  ADD COLUMN IF NOT EXISTS internal_host_rate_cents bigint;
