-- 0022_call_outcomes.sql
-- =========================================================================
-- Extend the outreach_outcome enum with three call-specific outcomes the
-- operators flagged during workflow review. Existing values:
--   sent, bad_email, bounced, no_answer, voicemail, callback_requested,
--   declined, interested, confirmed, contract_signed, wrong_number
--
-- New:
--   email_collected   — Spoke briefly, got their email, asked us to email
--                       instead of phone. Triggers a follow-up email task.
--   competing_event   — They have their own event going that conflicts
--                       with the crawl date / vibe. Soft no.
--   hours_mismatch    — Their open hours don't fit any of our crawl slots
--                       (kitchen closes 9pm, daytime-only, etc).
--
-- Idempotent via DO blocks; safe to re-run.
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'email_collected'
                   AND enumtypid = 'outreach_outcome'::regtype) THEN
    ALTER TYPE outreach_outcome ADD VALUE 'email_collected';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'competing_event'
                   AND enumtypid = 'outreach_outcome'::regtype) THEN
    ALTER TYPE outreach_outcome ADD VALUE 'competing_event';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'hours_mismatch'
                   AND enumtypid = 'outreach_outcome'::regtype) THEN
    ALTER TYPE outreach_outcome ADD VALUE 'hours_mismatch';
  END IF;
END $$;
