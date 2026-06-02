-- =========================================================================
-- 0086_event_day_audit_triggers.sql
--
-- Event-day operational tables were created in later migrations (crawl_issues,
-- crawl_deliverables, call_logs, crawl_hosts, internal_hosts, external_hosts)
-- and never got an audit trigger attached the way 0002 wired up the core
-- tables. That means cancellations, host reassignments, deliverable changes,
-- and call-log edits made during live support are NOT forensically tracked.
--
-- This migration attaches the existing audit_trigger_func() (defined in
-- 0001_init, wired in 0002_audit_triggers_and_indexes) to those tables, using
-- the exact same pattern:
--   AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW EXECUTE audit_trigger_func()
--
-- Idempotent: each trigger is DROP ... IF EXISTS first, so re-running (or
-- running after a partial earlier attempt) is safe. Tables that already carry
-- an audit trigger (crawl_issues, call_logs in some environments) get the
-- trigger re-created identically -- no behaviour change.
--
-- All wrapped in DO blocks that no-op when the target table does not exist,
-- so this migration is safe on environments where a given table was never
-- created.
-- =========================================================================

DO $$
DECLARE
  t text;
  audited_tables text[] := ARRAY[
    'crawl_issues',
    'crawl_deliverables',
    'call_logs',
    'crawl_hosts',
    'internal_hosts',
    'external_hosts'
  ];
BEGIN
  FOREACH t IN ARRAY audited_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_audit', t);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I '
        || 'FOR EACH ROW EXECUTE FUNCTION audit_trigger_func()',
        t || '_audit', t
      );
    END IF;
  END LOOP;
END
$$;
