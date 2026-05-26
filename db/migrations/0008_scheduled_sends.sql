-- =========================================================================
-- 0008_scheduled_sends.sql
--
-- Phase 2: Controlled send queue. Operator picks N venues + a template,
-- the engine spaces sends across the day with jitter, respecting the
-- inbox's per-day cap and minimum spacing.
--
-- Lifecycle per row:
--   pending  → queued, waiting for scheduled_for
--   sending  → worker has claimed it
--   sent     → outreach_log entry exists, references this row
--   failed   → Gmail / SMTP rejected; failure_reason populated
--   canceled → operator pulled it out of the queue before send
--
-- The queue is keyed on (staff_outreach_email_id, scheduled_for). The
-- worker (Phase 2 send-loop) selects WHERE scheduled_for <= NOW() AND
-- status='pending', locks with SKIP LOCKED to avoid double-claim, and
-- fires one at a time.
--
-- We do NOT denormalize the rendered subject/body into the queue row.
-- They're built fresh at send time from the template_id + the venue's
-- current state, so if the operator edits the template after queuing,
-- the latest version goes out.
-- =========================================================================

CREATE TABLE IF NOT EXISTS scheduled_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who's sending + which inbox
  staff_member_id uuid NOT NULL REFERENCES staff_members(id) ON DELETE RESTRICT,
  staff_outreach_email_id uuid NOT NULL REFERENCES staff_outreach_emails(id) ON DELETE RESTRICT,
  outreach_brand_id uuid NOT NULL REFERENCES outreach_brands(id) ON DELETE RESTRICT,

  -- What they're sending to
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  venue_event_id uuid REFERENCES venue_events(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,

  -- Template snapshot (id only — content rendered at send time)
  email_template_id uuid NOT NULL REFERENCES email_templates(id) ON DELETE RESTRICT,

  -- Optional operator overrides at queue time. When NULL the engine
  -- renders from the template at send time. When set, this exact string
  -- goes out (operator manually edited before queueing).
  subject_override text,
  body_text_override text,

  -- Status machine
  status text NOT NULL DEFAULT 'pending',
  CONSTRAINT scheduled_sends_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'canceled')),

  -- Schedule
  scheduled_for timestamptz NOT NULL,
  -- Soft "send any time today within this window" if both set; otherwise
  -- engine treats scheduled_for as exact.
  window_start timestamptz,
  window_end timestamptz,

  -- Outcome
  sent_at timestamptz,
  outreach_log_id uuid REFERENCES outreach_log(id) ON DELETE SET NULL,
  failure_reason text,
  failure_count integer NOT NULL DEFAULT 0,

  -- Batch — operator-supplied label for "queue all 30 as Halloween cold batch #1"
  batch_id uuid,
  batch_label text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

-- Worker query: WHERE status='pending' AND scheduled_for <= now() ORDER BY scheduled_for
CREATE INDEX IF NOT EXISTS scheduled_sends_due_idx
  ON scheduled_sends(scheduled_for)
  WHERE status = 'pending';

-- Per-inbox queue view
CREATE INDEX IF NOT EXISTS scheduled_sends_inbox_idx
  ON scheduled_sends(staff_outreach_email_id, scheduled_for);

-- Batch lookup
CREATE INDEX IF NOT EXISTS scheduled_sends_batch_idx
  ON scheduled_sends(batch_id)
  WHERE batch_id IS NOT NULL;

-- Touch updated_at
DROP TRIGGER IF EXISTS touch_scheduled_sends ON scheduled_sends;
CREATE TRIGGER touch_scheduled_sends
  BEFORE UPDATE ON scheduled_sends
  FOR EACH ROW
  EXECUTE FUNCTION touch_updated_at_func();

-- Audit
DROP TRIGGER IF EXISTS audit_scheduled_sends ON scheduled_sends;
CREATE TRIGGER audit_scheduled_sends
  AFTER INSERT OR UPDATE OR DELETE ON scheduled_sends
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_func();
