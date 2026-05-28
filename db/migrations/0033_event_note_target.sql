-- Migration 0033 — Add 'event' to note_target_type
--
-- Operator session-12 P3: per-crawl notes. A crawl is an `events` row,
-- so notes attach to it via the existing polymorphic notes table
-- (target_type, target_id). This adds the new target_type value.
--
-- ADD VALUE IF NOT EXISTS is idempotent. Note: in older Postgres,
-- ALTER TYPE ... ADD VALUE cannot run inside a txn block with other
-- statements that use the new value; here it's the only statement so
-- the deploy runner applying files individually is fine.

ALTER TYPE note_target_type ADD VALUE IF NOT EXISTS 'event';
