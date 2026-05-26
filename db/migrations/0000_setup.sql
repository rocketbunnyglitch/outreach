-- =========================================================================
-- 0000_setup.sql — Phase 1 initial setup (custom migration)
--
-- Establishes Postgres extensions and the helper functions used by triggers
-- attached to every audited table in 0002_audit_triggers.sql.
-- =========================================================================

-- ---------- Extensions ----------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------- Audit trigger function ----------
-- Reads actor from `app.current_user_id` session setting, populated by
-- lib/db.ts withAuditContext(). NULL if unset.
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
  actor uuid;
  record_id_value uuid;
BEGIN
  BEGIN
    actor := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    actor := NULL;
  END;

  IF (TG_OP = 'DELETE') THEN
    record_id_value := (to_jsonb(OLD) ->> 'id')::uuid;
    INSERT INTO audit_log (table_name, record_id, operation, changed_by, old_values, new_values)
    VALUES (TG_TABLE_NAME, record_id_value, 'DELETE', actor, to_jsonb(OLD), NULL);
    RETURN OLD;

  ELSIF (TG_OP = 'UPDATE') THEN
    IF to_jsonb(OLD) = to_jsonb(NEW) THEN
      RETURN NEW;
    END IF;
    record_id_value := (to_jsonb(NEW) ->> 'id')::uuid;
    INSERT INTO audit_log (table_name, record_id, operation, changed_by, old_values, new_values)
    VALUES (TG_TABLE_NAME, record_id_value, 'UPDATE', actor, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;

  ELSIF (TG_OP = 'INSERT') THEN
    record_id_value := (to_jsonb(NEW) ->> 'id')::uuid;
    INSERT INTO audit_log (table_name, record_id, operation, changed_by, old_values, new_values)
    VALUES (TG_TABLE_NAME, record_id_value, 'INSERT', actor, NULL, to_jsonb(NEW));
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ---------- Updated-at touch trigger ----------
CREATE OR REPLACE FUNCTION touch_updated_at_func()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- Optimistic locking version bump ----------
CREATE OR REPLACE FUNCTION bump_version_func()
RETURNS TRIGGER AS $$
BEGIN
  IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
    NEW.version := COALESCE(OLD.version, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
