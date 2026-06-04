-- Phase 1.12: reconcile reply_classification with the Halloween 2026 Reference
-- Doc. Two states have no engine equivalent today:
--   stalled_warm      = was warm/engaged, then went quiet (NOT a decline)
--   cancelled_by_them = venue confirmed, then backed out (NOT a pre-confirm decline)
--
-- ADD VALUE IF NOT EXISTS is idempotent. deploy.sh applies each migration with
-- psql -f in autocommit (no enclosing transaction), and prod is PG16, so these
-- run outside a transaction block -- the only context where ADD VALUE is
-- unconditionally safe. The new values are not USED in this migration.
ALTER TYPE reply_classification ADD VALUE IF NOT EXISTS 'stalled_warm';
ALTER TYPE reply_classification ADD VALUE IF NOT EXISTS 'cancelled_by_them';
