-- 0063_classification_warm_confirmed.sql
--
-- Adds two new reply_classification enum values to match the
-- operator's actual outreach lifecycle:
--
--   warm       The lead replied positively but with questions /
--              caveats — interested-but-not-yet-confirmed. This is
--              the gray area between "interested" and "confirmed"
--              that the existing "question" + "interested" labels
--              don't capture cleanly.
--
--   confirmed  The lead confirmed they'll do the crawl — booked,
--              scheduled, locked in. Distinct from "interested"
--              which is just "yes, tell me more" — confirmed means
--              we're done outreach-ing and can move on.
--
-- Postgres ALTER TYPE ... ADD VALUE is non-transactional, so we
-- run each ADD on its own line. IF NOT EXISTS makes the migration
-- safe to re-run (Postgres 9.6+).

ALTER TYPE reply_classification ADD VALUE IF NOT EXISTS 'warm';
ALTER TYPE reply_classification ADD VALUE IF NOT EXISTS 'confirmed';
