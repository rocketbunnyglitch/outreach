-- =========================================================================
-- 0094_cadence_rewrite.sql
--
-- Schema for the new cadence engine (Phase 1.7). Adds a per-thread
-- cadence_state machine + next-due timestamp to email_threads, and a
-- venue_campaign_touch_log recording every outbound touch so the cadence
-- floor (anti-spam) can be enforced across aliases + domains.
--
-- Note: the touch log's staff_outreach_email_id references connected_accounts,
-- not staff_outreach_emails -- that table was renamed to connected_accounts in
-- migration 0042 (db/schema/users.ts: staffOutreachEmails = connectedAccounts).
-- email_threads.staff_outreach_email_id already FKs connected_accounts the
-- same way.
--
-- Schema mirror: db/schema/enums.ts (cadenceState), db/schema/outreach.ts
-- (emailThreads), db/schema/venue-campaign-touch-log.ts.
-- =========================================================================

CREATE TYPE cadence_state AS ENUM (
  'cold_pending_touch_1',
  'cold_sent_touch_1',
  'cold_pending_touch_2',
  'cold_sent_touch_2',
  'cold_pending_touch_3',
  'cold_sent_touch_3',
  'cold_exhausted_ready_for_handoff',
  'warm_pending_response',
  'warm_responded_pending_nudge_1',
  'warm_nudge_1_sent',
  'warm_pending_nudge_2',
  'warm_nudge_2_sent',
  'warm_pending_nudge_3',
  'warm_nudge_3_sent',
  'stalled_warm',
  'declined_this_campaign',
  'opt_out_permanent',
  'cancelled_by_them',
  'confirmed',
  'lifecycle_active'
);

ALTER TABLE email_threads
  ADD COLUMN cadence_state cadence_state,
  ADD COLUMN cadence_next_due_at TIMESTAMPTZ;

CREATE INDEX email_threads_cadence_state_idx ON email_threads(cadence_state);
CREATE INDEX email_threads_cadence_due_idx ON email_threads(cadence_next_due_at)
  WHERE cadence_state IS NOT NULL;

CREATE TABLE venue_campaign_touch_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  staff_outreach_email_id UUID NOT NULL REFERENCES connected_accounts(id),
  outreach_brand_id UUID NOT NULL REFERENCES outreach_brands(id),
  touch_kind TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  email_message_id UUID REFERENCES email_messages(id) ON DELETE SET NULL
);

CREATE INDEX vctl_venue_campaign_idx ON venue_campaign_touch_log(venue_id, campaign_id, sent_at DESC);
CREATE INDEX vctl_brand_recent_idx ON venue_campaign_touch_log(venue_id, outreach_brand_id, sent_at DESC);
