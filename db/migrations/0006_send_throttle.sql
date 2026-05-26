-- =========================================================================
-- 0006_send_throttle.sql
--
-- Per-inbox deliverability throttle settings. Cold-email best practice is
-- 25-50/day per established inbox with a 10-30/day warm-up ramp over the
-- first ~14 days. Google Workspace's hard ceiling is 2,000/day for paid
-- accounts but anything above ~50 cold sends/day to unverified recipients
-- tanks deliverability.
--
-- The "effective" cap is computed at query time as the lesser of
-- daily_send_limit and the warm-up ramp value when warmup_phase is true.
-- See lib/send-throttle.ts.
-- =========================================================================

ALTER TABLE staff_outreach_emails
  ADD COLUMN IF NOT EXISTS daily_send_limit integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS hourly_send_limit integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS min_seconds_between_sends integer NOT NULL DEFAULT 90,

  -- Warm-up: new inboxes start at 10/day and ramp +2/day over 14 days.
  -- When the staffer first connects an inbox, warmup_started_at is set
  -- to NOW(). Day 14 the warmup_phase auto-flips to false (handled at
  -- read time via the effective_cap computation; no scheduled job).
  ADD COLUMN IF NOT EXISTS warmup_phase boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS warmup_started_at timestamptz,

  -- Business-hours gating (interpreted in the inbox's local timezone,
  -- which we get from the staff_members.timezone).
  ADD COLUMN IF NOT EXISTS business_hours_only boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS weekdays_only boolean NOT NULL DEFAULT true,

  -- Auto-pause flag: set to true when bounce_rate spikes above 2%
  -- in the last 30 days. Operator must manually clear to resume.
  ADD COLUMN IF NOT EXISTS auto_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_paused_reason text;

-- Seed warmup_started_at for any existing connected inboxes so they
-- start their ramp from "now" rather than NULL.
UPDATE staff_outreach_emails
  SET warmup_started_at = COALESCE(warmup_started_at, last_synced_at, NOW())
  WHERE status = 'connected' AND warmup_started_at IS NULL;

-- Helper index for the 24h rolling-window query (already exists at
-- outreach_log_staff_created_idx via (staff_member_id, created_at), but
-- we'll query by staff_outreach_email_id specifically).
CREATE INDEX IF NOT EXISTS outreach_log_staff_outreach_email_created_idx
  ON outreach_log(staff_outreach_email_id, created_at DESC)
  WHERE staff_outreach_email_id IS NOT NULL;
