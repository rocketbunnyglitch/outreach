-- Backfill mis-filed thread directions.
--
-- A thread carrying BOTH inbound and outbound messages must be 'mixed' so it
-- shows in BOTH the Inbox (direction IN inbound/mixed) and Sent
-- (direction IN outbound/mixed) folders. The Gmail poll worker's
-- thread-update path never promoted direction when a new message arrived on an
-- existing thread, so:
--   - a thread staff STARTED (direction='outbound') stayed 'outbound' after the
--     venue replied -> the reply was hidden from Inbox, only visible in Sent
--     (marked unread / "new mail"); and
--   - a thread a venue STARTED (direction='inbound') that we later replied to
--     from Gmail directly stayed 'inbound' -> missing from Sent.
-- The poll worker now flips direction to 'mixed' on ingest; this repairs the
-- ~527 already-stuck rows. Idempotent: after running, no row matches (direction
-- is 'mixed'), and last_inbound_at/last_outbound_at are only ever set when a
-- real message of that direction was ingested.
UPDATE email_threads
SET direction = 'mixed', updated_at = now()
WHERE deleted_at IS NULL
  AND (
    (direction = 'outbound' AND last_inbound_at IS NOT NULL)
    OR (direction = 'inbound' AND last_outbound_at IS NOT NULL)
  );
