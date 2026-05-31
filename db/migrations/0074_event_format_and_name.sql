-- Operator request: Day-Party crawl format + custom crawl name.
--
-- 1. events.crawl_format  enum: 'standard' | 'day_party'
--
--    A Day-Party crawl has a different venue mix:
--      - wristband: 1 (same as standard)
--      - middles: at least 2 (same as standard)
--      - final: NOT required — day parties wrap before the final hour
--
--    The tracker renders day-party crawls with no "final" venue cell,
--    so the deficit/completion predicate has to switch to count
--    needed venues based on this format flag.
--
--    Idempotent enum + column creation.
--
-- 2. events.crawl_name  text
--
--    Operator wants to bulk-rename certain crawl numbers — e.g.
--    "all Saturday crawl 4's are Day Parties" — so we need a free-
--    text display name that overlays the auto-generated label.
--    NULL = use the auto label (current behavior). When set, the
--    tracker + email composer pick this up.

-- =========================================================================
-- crawl_format enum + column
-- =========================================================================

DO $$ BEGIN
  CREATE TYPE crawl_format AS ENUM ('standard', 'day_party');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS crawl_format crawl_format NOT NULL DEFAULT 'standard';

-- =========================================================================
-- crawl_name (free-text override)
-- =========================================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS crawl_name text;
