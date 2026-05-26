-- =========================================================================
-- 0009_followup_cadence.sql
--
-- Phase 3: Automated follow-ups.
--
-- A "cadence" is a sequence of follow-up templates with delays:
--   Step 1: cold first-touch (manual or bulk-queue, not part of cadence)
--   Step 2: follow_up_1, fires 4 days after Step 1 if no reply
--   Step 3: follow_up_2, fires 7 days after Step 2 if no reply
--   ...
--
-- When a cold email goes out (via send-outreach or send-worker), the
-- engine creates an outreach_sequence_state row tracking which step is
-- next for that (venue, outreach_brand) pair. The send worker picks up
-- due follow-ups and fires them — same throttle path as cold sends, but
-- the throttle treats follow-ups as a lower spam risk (warmer).
--
-- Stop conditions (flip stopped_at + stopped_reason):
--   - reply received (inbound poller → email_threads → reply detected)
--   - bounce (Gmail returns 5xx or postmaster bounce)
--   - unsubscribe (recipient clicks one-click link → /unsubscribe?token=...)
--   - decline (operator marks outreach_log outcome=declined)
--   - manual stop (operator clicks "Stop sequence" on venue page)
-- =========================================================================

-- ---------- Cadence steps per outreach brand ----------
CREATE TABLE IF NOT EXISTS outreach_cadence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  outreach_brand_id uuid NOT NULL REFERENCES outreach_brands(id) ON DELETE CASCADE,

  /**
   * 1-indexed. Step 1 = the cold first-touch template (not auto-sent;
   * the operator initiates via composer or bulk queue). Steps 2+ are
   * auto follow-ups in the cadence.
   */
  step_number smallint NOT NULL,

  email_template_id uuid NOT NULL REFERENCES email_templates(id) ON DELETE RESTRICT,

  /** Delay AFTER the previous step's send (not from step 1). */
  delay_days smallint NOT NULL,

  /** Optional override of the delay's hour-of-day (e.g. always send at 10am). */
  send_hour smallint,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,

  CONSTRAINT outreach_cadence_steps_step_check CHECK (step_number BETWEEN 1 AND 10),
  CONSTRAINT outreach_cadence_steps_delay_check CHECK (delay_days BETWEEN 0 AND 90)
);

CREATE UNIQUE INDEX IF NOT EXISTS outreach_cadence_steps_brand_step_unique
  ON outreach_cadence_steps(outreach_brand_id, step_number);

DROP TRIGGER IF EXISTS touch_outreach_cadence_steps ON outreach_cadence_steps;
CREATE TRIGGER touch_outreach_cadence_steps
  BEFORE UPDATE ON outreach_cadence_steps
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();

DROP TRIGGER IF EXISTS audit_outreach_cadence_steps ON outreach_cadence_steps;
CREATE TRIGGER audit_outreach_cadence_steps
  AFTER INSERT OR UPDATE OR DELETE ON outreach_cadence_steps
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ---------- Per-(venue, brand) sequence state ----------
CREATE TABLE IF NOT EXISTS outreach_sequence_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  outreach_brand_id uuid NOT NULL REFERENCES outreach_brands(id) ON DELETE CASCADE,
  /**
   * The staffer who started the sequence (kicked off step 1). Follow-ups
   * are attributed to the same staffer's inbox so the reply lands in
   * their inbox.
   */
  staff_member_id uuid NOT NULL REFERENCES staff_members(id) ON DELETE RESTRICT,
  staff_outreach_email_id uuid NOT NULL REFERENCES staff_outreach_emails(id) ON DELETE RESTRICT,
  recipient_email text NOT NULL,

  /** Which step was last sent. 1 = cold first-touch sent. */
  last_step_sent smallint NOT NULL DEFAULT 1,
  last_step_sent_at timestamptz NOT NULL DEFAULT now(),

  /** Next step that the worker should fire when due. NULL = sequence complete. */
  next_step_number smallint,
  next_step_due_at timestamptz,

  /** Unsubscribe / opt-out token — embed in template as one-click link. */
  unsubscribe_token text NOT NULL,

  /** Stop state */
  stopped_at timestamptz,
  stopped_reason text,
    -- 'replied' | 'bounced' | 'unsubscribed' | 'declined' | 'manual' | 'completed'

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,

  CONSTRAINT outreach_sequence_state_stopped_reason_check CHECK (
    stopped_reason IS NULL OR stopped_reason IN (
      'replied', 'bounced', 'unsubscribed', 'declined', 'manual', 'completed'
    )
  )
);

-- One active sequence per (venue, brand). Operator can't double-enroll.
-- Stopped sequences don't block re-enrollment (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS outreach_sequence_state_active_unique
  ON outreach_sequence_state(venue_id, outreach_brand_id)
  WHERE stopped_at IS NULL;

CREATE INDEX IF NOT EXISTS outreach_sequence_state_due_idx
  ON outreach_sequence_state(next_step_due_at)
  WHERE stopped_at IS NULL AND next_step_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS outreach_sequence_state_token_unique
  ON outreach_sequence_state(unsubscribe_token);

CREATE INDEX IF NOT EXISTS outreach_sequence_state_venue_idx
  ON outreach_sequence_state(venue_id);

DROP TRIGGER IF EXISTS touch_outreach_sequence_state ON outreach_sequence_state;
CREATE TRIGGER touch_outreach_sequence_state
  BEFORE UPDATE ON outreach_sequence_state
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();

DROP TRIGGER IF EXISTS audit_outreach_sequence_state ON outreach_sequence_state;
CREATE TRIGGER audit_outreach_sequence_state
  AFTER INSERT OR UPDATE OR DELETE ON outreach_sequence_state
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ---------- Venue-level DNC mirror (for unsubscribe efficiency) ----------
-- venues.do_not_contact already exists. We add a "globally unsubscribed"
-- flag for the public-facing one-click link so a recipient who clicks
-- "unsubscribe" stops ALL future sequences across brands.
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;

-- ---------- Send kind on scheduled_sends ----------
-- Phase 4 cascade sends are transactional (go to confirmed relationships)
-- and must bypass cold-send throttle. Cold + follow-up sends use the
-- throttle. Default is 'cold' so existing rows are unchanged.
ALTER TABLE scheduled_sends
  ADD COLUMN IF NOT EXISTS send_kind text NOT NULL DEFAULT 'cold';

ALTER TABLE scheduled_sends
  ADD CONSTRAINT scheduled_sends_send_kind_check
    CHECK (send_kind IN ('cold', 'follow_up', 'transactional'));
