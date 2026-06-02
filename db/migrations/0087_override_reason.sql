-- =========================================================================
-- 0087_override_reason.sql
--
-- Dangerous operator overrides -- cancelling a crawl (events.status ->
-- 'cancelled', via archiveEvent) and archiving a city (cities.archived_at,
-- via archiveCity) -- previously required no justification and left nothing
-- behind explaining WHY. This adds a free-text override_reason column to both
-- tables so the action can persist the operator's stated reason.
--
-- Because both events and cities already carry the audit trigger
-- (0002_audit_triggers_and_indexes), writing override_reason as part of the
-- same UPDATE means the new value is captured in audit_log.new_values and
-- surfaces in the existing /audit viewer (the diff lists "override_reason"
-- as a changed field, and the JSONB carries the text). No new table needed.
--
-- Nullable: the column is only populated on override actions; ordinary edits
-- leave it NULL. Idempotent via IF NOT EXISTS.
-- =========================================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS override_reason text;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS override_reason text;
