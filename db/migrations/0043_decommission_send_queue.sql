-- 0043_decommission_send_queue.sql
-- Removes the brand-scoped cold-outreach send queue (Phase 6 of the
-- original spec). Operator decided this session that the queue's
-- model — Gmail-per-(user × brand), warmup ramps, daily caps, multi-
-- step cadences — is the wrong shape for how the team actually works.
-- The new model is simpler: connected_accounts holds Gmail inboxes
-- (one row per Gmail address per user) and brand is picked at send
-- time from the campaign/city context, not pinned to the inbox.
--
-- This migration:
--   1. Drops the three send-queue tables (scheduled_sends,
--      outreach_cadence_steps, outreach_sequence_state)
--   2. Drops the send-throttling columns on connected_accounts
--      (daily_send_limit, hourly_send_limit, etc — they were only
--      meaningful when the queue existed)
--   3. Leaves email_threads / email_messages untouched — those are
--      the inbox surface and survive the decommission
--
-- DESTRUCTIVE: any data in these tables is lost. Operator confirmed
-- the queue has never been used in production; the tables are
-- effectively empty.
--
-- The application code that consumed these tables is deleted in the
-- same commit (lib/send-outreach.ts, lib/send-worker.ts,
-- lib/outreach-sequences.ts, lib/cascade-sends*.ts, lib/composer-
-- data.ts, lib/send-throttle.ts, lib/send-cap-status.ts, the
-- /send-queue page, the brand cadence editor, the send-composer +
-- bulk-send-dialog UI, and the cron worker + public unsubscribe
-- route). If only the migration ships, the build breaks; if only
-- the code change ships, the DB is dirty. Ship them together.

-- ---------------------------------------------------------------
-- Step 1: drop the cascading FK constraints first, in case any
--         remain pointing at these tables from elsewhere.
-- ---------------------------------------------------------------
-- (Most FKs are FROM these tables TO others; dropping the tables
-- removes those automatically. But scheduled_sends has a
-- self-referential parent_send_id FK that we want to drop
-- explicitly before the table goes.)

-- ---------------------------------------------------------------
-- Step 2: drop the send-queue tables.
-- ---------------------------------------------------------------
DROP TABLE IF EXISTS outreach_sequence_state CASCADE;
DROP TABLE IF EXISTS outreach_cadence_steps CASCADE;
DROP TABLE IF EXISTS scheduled_sends CASCADE;

-- ---------------------------------------------------------------
-- Step 3: drop send-throttling columns from connected_accounts.
--         These were per-inbox rate-limits enforced by the queue
--         worker; with the worker gone, the columns are dead.
-- ---------------------------------------------------------------
ALTER TABLE connected_accounts
  DROP COLUMN IF EXISTS daily_send_limit,
  DROP COLUMN IF EXISTS hourly_send_limit,
  DROP COLUMN IF EXISTS min_seconds_between_sends,
  DROP COLUMN IF EXISTS warmup_phase,
  DROP COLUMN IF EXISTS warmup_started_at,
  DROP COLUMN IF EXISTS business_hours_only,
  DROP COLUMN IF EXISTS weekdays_only,
  DROP COLUMN IF EXISTS auto_paused_at,
  DROP COLUMN IF EXISTS auto_paused_reason;

-- ---------------------------------------------------------------
-- Step 4: drop the unsubscribe-tracking columns from venues that
--         were used by the cadence unsubscribe link. Operator
--         can manually mark a venue do_not_contact via the UI —
--         the auto-unsubscribe flow is gone with the cadences.
-- ---------------------------------------------------------------
-- venues.unsubscribed_at was added by an earlier migration to
-- support the public /unsubscribe?token=... route. With the route
-- deleted, the column is dead. We DO keep venues.do_not_contact
-- because the operator UI still uses it as a manual flag.
ALTER TABLE venues
  DROP COLUMN IF EXISTS unsubscribed_at;
