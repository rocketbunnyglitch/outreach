-- 0055_email_drafts.sql
--
-- Backend table for the global Gmail-style composer. Each row is
-- ONE in-progress draft owned by a user. Autosaved by the composer
-- while editing; deleted when the user discards or successfully sends.
--
-- Schedule + undo support are wired into the same table so a single
-- "send my draft" path handles all three modes:
--   sent_at IS NULL + scheduled_for IS NULL → editable draft
--   sent_at IS NULL + scheduled_for IS NOT NULL → scheduled
--   sent_at IS NOT NULL → already sent (kept as audit shadow until
--                                       we purge sent-and-confirmed
--                                       drafts on a cron)
--
-- Attachments are a JSONB array of file metadata for v1. Real file
-- storage (S3 / GCS) is TODO; the column exists so the UI can show
-- the chip list without faking the data shape.

CREATE TABLE IF NOT EXISTS email_drafts (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Owner — every draft belongs to a single user. RLS enforced at
    -- the action layer via requireStaff + this column.
    owner_user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id                 uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    -- Which inbox sends this. NULL until the operator picks one in
    -- the From dropdown.
    connected_account_id    uuid REFERENCES connected_accounts(id) ON DELETE SET NULL,
    -- Recipients. Stored as text[] so postgres array operators work
    -- (intersection, contains) for future dedupe queries.
    to_addresses            text[] NOT NULL DEFAULT ARRAY[]::text[],
    cc_addresses            text[] NOT NULL DEFAULT ARRAY[]::text[],
    bcc_addresses           text[] NOT NULL DEFAULT ARRAY[]::text[],
    subject                 text NOT NULL DEFAULT '',
    body_text               text NOT NULL DEFAULT '',
    body_html               text,
    -- Outreach attribution.
    venue_id                uuid REFERENCES venues(id) ON DELETE SET NULL,
    city_campaign_id        uuid REFERENCES city_campaigns(id) ON DELETE SET NULL,
    -- Selected template the operator started from, if any. NULL when
    -- the body was authored freehand.
    template_id             uuid REFERENCES email_templates(id) ON DELETE SET NULL,
    -- Attachment metadata: [{ name, size, mime, storage_key? }, ...].
    -- storage_key is the future S3 path; absent until file storage
    -- ships. We keep the shape stable so frontend code doesn't churn.
    attachments             jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Scheduling. NULL = send now. Set by the schedule-send dropdown.
    scheduled_for           timestamptz,
    -- Mark as sent when the send pipeline completes successfully.
    sent_at                 timestamptz,
    sent_thread_id          uuid REFERENCES email_threads(id) ON DELETE SET NULL,
    -- Timestamps.
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Common access patterns:
--   loadMyDrafts(userId)  → owner_user_id + sent_at IS NULL ordered by updated_at DESC
--   scheduledForCron      → scheduled_for <= now() AND sent_at IS NULL
CREATE INDEX IF NOT EXISTS email_drafts_owner_open_idx
    ON email_drafts (owner_user_id, updated_at DESC)
    WHERE sent_at IS NULL;

CREATE INDEX IF NOT EXISTS email_drafts_scheduled_idx
    ON email_drafts (scheduled_for)
    WHERE sent_at IS NULL AND scheduled_for IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_drafts_venue_idx
    ON email_drafts (venue_id) WHERE venue_id IS NOT NULL;
