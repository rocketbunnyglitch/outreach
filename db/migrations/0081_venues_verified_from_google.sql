-- Mark venues whose name + address have been verified against the
-- canonical Google Maps record (via the operator's Claude-in-Chrome
-- verify pass, which PATCHes /api/admin/venues/[id] with
-- verifiedFromGoogle: true).
--
-- The resolver consults this timestamp during xlsx imports:
--   - When NOT NULL, name and address are LOCKED — subsequent
--     imports will not backfill those fields even if the source row
--     has different values. (Other fields — email, phone, contact_name,
--     capacity — still backfill on NULL.)
--   - When NULL, the standard NULL-only backfill rule applies.
--
-- This protects manually-verified data from being silently overwritten
-- when a different campaign import lands the same venue with stale
-- info.
--
-- Idempotent. The PATCH endpoint sets this column to NOW() going
-- forward; venues verified BEFORE this migration stay NULL and rely
-- on the (already-effective) non-NULL field-skip rule.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS verified_from_google_at timestamptz;

-- Partial index to speed up resolver queries that filter on this
-- field. Small index since only verified venues land here.
CREATE INDEX IF NOT EXISTS venues_verified_from_google_idx
  ON venues (verified_from_google_at)
  WHERE verified_from_google_at IS NOT NULL;
