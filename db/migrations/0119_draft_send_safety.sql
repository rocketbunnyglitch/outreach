-- Send-safety boundary on email_drafts (P0-1). "Engine drafts. Humans send."
--
-- The scheduled-send cron may ONLY dispatch a draft that is either
-- send_mode='operator_scheduled' with approved_at set (a human reviewed +
-- scheduled it), OR send_mode='auto_allowed' for a non-venue recipient
-- (host/internal/system transactional). Engine-generated drafts default to
-- send_mode='review_required' and are never auto-sent -- they surface in the
-- operator worklist for review. See lib/scheduled-send-runner.ts.
--
-- venue_event_id lets cancellation scope draft cleanup to ONE night of a
-- multi-night venue (P0-5). FK SET NULL so a removed venue_event never blocks
-- a draft. created_by/updated_by parity not needed (this table predates that
-- convention). approved_by/scheduled_by reference users(id) (renamed @0041).

ALTER TABLE email_drafts
  ADD COLUMN IF NOT EXISTS send_mode TEXT NOT NULL DEFAULT 'review_required',
  ADD COLUMN IF NOT EXISTS requires_human_approval BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approved_by_staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_by_staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_send_allowed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recipient_type TEXT NOT NULL DEFAULT 'venue',
  ADD COLUMN IF NOT EXISTS touch_type TEXT,
  ADD COLUMN IF NOT EXISTS venue_event_id UUID REFERENCES venue_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS email_drafts_venue_event_idx ON email_drafts (venue_event_id);

-- Backfill: existing scheduled, unsent drafts that are NOT lifecycle templates
-- are operator-queued cold sends (queueColdSend) -- the operator already
-- reviewed them, so preserve their send by marking them operator_scheduled +
-- approved. Lifecycle templates (T9-T17), if any are scheduled, stay
-- review_required (the safe default) so they never auto-send unreviewed.
UPDATE email_drafts d
SET send_mode = 'operator_scheduled',
    requires_human_approval = false,
    approved_at = COALESCE(d.approved_at, now())
WHERE d.scheduled_for IS NOT NULL
  AND d.sent_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM email_templates t
    WHERE t.id = d.template_id
      AND t.template_code IN (
        'T9','T9-far','T9-near','T10','T11','T11-wristband','T11-other',
        'T13','T13W','T14','T15','T16','T17'
      )
  );
