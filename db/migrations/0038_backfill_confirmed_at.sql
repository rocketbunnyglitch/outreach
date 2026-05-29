-- 0038_backfill_confirmed_at.sql
--
-- Backfill venue_events.confirmed_at for rows that have status =
-- 'confirmed' but a NULL confirmed_at. Caused by the city-sheet slot
-- update action (_slot-actions.ts) previously setting status without
-- stamping the timestamp; the Today widget's "Recent wins" query
-- requires confirmed_at IS NOT NULL, so confirmations made via that
-- path never surfaced.
--
-- Strategy: use the row's updated_at as the best-available proxy for
-- when the confirmation happened. It's not exact (a later edit will
-- have moved updated_at forward), but it's the closest signal we have
-- without a full audit_log scan, and it puts those rows back into the
-- queryable space so they at least show up as historical wins.
--
-- Idempotent: only touches rows where confirmed_at is currently NULL.

UPDATE venue_events
   SET confirmed_at = COALESCE(confirmed_at, updated_at, NOW())
 WHERE status IN ('confirmed', 'contract_signed')
   AND confirmed_at IS NULL;
