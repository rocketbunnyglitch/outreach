-- 0133: track WHO finalized each crawl (confirmed the venue that filled the
-- last required slot) + a 'quick_win' notification kind for the big
-- "%name% finalized %city%!" broadcast. Powers the admin finalized-crawls
-- leaderboard. Expand-only per the migration policy.

ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'quick_win';

CREATE TABLE IF NOT EXISTS crawl_finalizations (
  event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES users(id) ON DELETE SET NULL,
  city_campaign_id uuid REFERENCES city_campaigns(id) ON DELETE SET NULL,
  finalized_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crawl_finalizations_staff_idx
  ON crawl_finalizations (staff_id, finalized_at DESC);
