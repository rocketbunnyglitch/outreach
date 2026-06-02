-- 0086_email_messages_bcc_gin.sql
--
-- Adds a GIN index on email_messages.bcc_emails_normalized.
--
-- Migration 0083 added GIN indexes for to_emails_normalized and
-- cc_emails_normalized (so `WHERE col && ARRAY[...]` overlap lookups
-- are fast), but it left bcc_emails_normalized unindexed -- at the
-- time nothing queried it.
--
-- The venue communication timeline now matches BCC recipients too
-- (lib/venue-communication.ts email_match branch ORs in
-- `bcc_emails_normalized && $emails::text[]`). Without this index that
-- overlap predicate forces a sequential scan of email_messages on
-- every venue page load. This index makes it an index lookup, matching
-- the to_/cc_ paths from 0083.
--
-- Idempotent: IF NOT EXISTS so re-running the migration runner against
-- a DB that already has the index is a no-op.

CREATE INDEX IF NOT EXISTS email_messages_bcc_emails_normalized_gin_idx
  ON email_messages USING GIN (bcc_emails_normalized);
