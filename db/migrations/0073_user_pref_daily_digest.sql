-- Phase D.4 — Daily team digest.
--
-- Two small additions:
--
--   user_preferences.daily_digest_enabled
--     boolean, default TRUE. NULL is treated as opt-in (since
--     the row may not exist for new users). FALSE = the cron
--     skips this user.
--
--   staff_members.digest_sent_at
--     timestamptz, NULL until the first digest sends. Used as
--     a per-day idempotency guard so re-running the cron on
--     the same UTC day no-ops for already-sent users.
--
-- Idempotent. No backfill — every existing user gets the
-- default opt-in and a NULL digest_sent_at.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS daily_digest_enabled boolean DEFAULT TRUE;

ALTER TABLE staff_members
  ADD COLUMN IF NOT EXISTS digest_sent_at timestamptz;

-- Cheap idempotency lookup. Partial = only rows that have ever
-- received a digest, which keeps the index tiny.
CREATE INDEX IF NOT EXISTS staff_members_digest_sent_idx
  ON staff_members (digest_sent_at DESC)
  WHERE digest_sent_at IS NOT NULL;
