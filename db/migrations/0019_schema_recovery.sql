BEGIN;

-- ---------------------------------------------------------------
-- Part A: middle_venue_groups + middle_venue_group_members
-- (from 0003_halloween_model.sql)
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS middle_venue_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_campaign_id uuid NOT NULL REFERENCES city_campaigns(id) ON DELETE CASCADE,
  name text NOT NULL,
  day_part day_part,
  status text NOT NULL DEFAULT 'planning',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS middle_venue_groups_cc_idx ON middle_venue_groups(city_campaign_id);
CREATE INDEX IF NOT EXISTS middle_venue_groups_daypart_idx ON middle_venue_groups(day_part);
CREATE INDEX IF NOT EXISTS middle_venue_groups_archived_idx ON middle_venue_groups(archived_at)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS middle_venue_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  middle_venue_group_id uuid NOT NULL REFERENCES middle_venue_groups(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'lead',
  slot_start_time time,
  slot_end_time time,
  agreed_hours_text text,
  drink_specials text,
  notes text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (middle_venue_group_id, venue_id)
);

CREATE INDEX IF NOT EXISTS middle_venue_group_members_group_idx
  ON middle_venue_group_members(middle_venue_group_id);
CREATE INDEX IF NOT EXISTS middle_venue_group_members_venue_idx
  ON middle_venue_group_members(venue_id);

-- Add FK from events.middle_venue_group_id (column already exists but unconstrained)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'events_middle_venue_group_id_fkey'
      AND table_name = 'events'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_middle_venue_group_id_fkey
      FOREIGN KEY (middle_venue_group_id)
      REFERENCES middle_venue_groups(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS events_middle_group_idx ON events(middle_venue_group_id)
  WHERE middle_venue_group_id IS NOT NULL;

-- Triggers on the recovered tables
DROP TRIGGER IF EXISTS middle_venue_groups_touch_updated_at ON middle_venue_groups;
CREATE TRIGGER middle_venue_groups_touch_updated_at BEFORE UPDATE ON middle_venue_groups
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
DROP TRIGGER IF EXISTS middle_venue_groups_bump_version ON middle_venue_groups;
CREATE TRIGGER middle_venue_groups_bump_version BEFORE UPDATE ON middle_venue_groups
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
DROP TRIGGER IF EXISTS middle_venue_groups_audit ON middle_venue_groups;
CREATE TRIGGER middle_venue_groups_audit AFTER INSERT OR UPDATE OR DELETE ON middle_venue_groups
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS middle_venue_group_members_touch_updated_at ON middle_venue_group_members;
CREATE TRIGGER middle_venue_group_members_touch_updated_at BEFORE UPDATE ON middle_venue_group_members
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
DROP TRIGGER IF EXISTS middle_venue_group_members_bump_version ON middle_venue_group_members;
CREATE TRIGGER middle_venue_group_members_bump_version BEFORE UPDATE ON middle_venue_group_members
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
DROP TRIGGER IF EXISTS middle_venue_group_members_audit ON middle_venue_group_members;
CREATE TRIGGER middle_venue_group_members_audit AFTER INSERT OR UPDATE OR DELETE ON middle_venue_group_members
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ---------------------------------------------------------------
-- Part B: notifications (from 0018_notifications.sql, audit_trigger -> audit_trigger_func)
-- ---------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_kind') THEN
    CREATE TYPE notification_kind AS ENUM (
      'reply', 'mention', 'email_invalid', 'ai_draft_failed', 'edit_conflict', 'admin_message'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  kind notification_kind NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_staff_unread_idx
  ON notifications(staff_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_staff_recent_idx
  ON notifications(staff_id, created_at DESC);

DROP TRIGGER IF EXISTS notifications_audit ON notifications;
CREATE TRIGGER notifications_audit
  AFTER INSERT OR UPDATE OR DELETE ON notifications
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ---------------------------------------------------------------
-- Part C: mark 0018 as applied (so the runner doesn't try to re-apply it later)
-- ---------------------------------------------------------------
INSERT INTO _outreach_migrations_applied (filename, applied_at, checksum)
VALUES ('0018_notifications.sql', NOW(), 'manual-recovery-after-audit-fn-typo')
ON CONFLICT (filename) DO NOTHING;


-- ---------------------------------------------------------------
-- Part D: ownership fixes. These objects are owned by whichever role
-- runs the migration; if 0019 is applied as a superuser on a fresh DB
-- (or, on the recovered VPS, where day_part was re-created as the
-- postgres role), force ownership back to crawl_engine_app so the app
-- can write to them. All ALTERs below are idempotent.
-- ---------------------------------------------------------------
ALTER TYPE day_part OWNER TO crawl_engine_app;
ALTER TYPE notification_kind OWNER TO crawl_engine_app;
ALTER TABLE middle_venue_groups OWNER TO crawl_engine_app;
ALTER TABLE middle_venue_group_members OWNER TO crawl_engine_app;
ALTER TABLE notifications OWNER TO crawl_engine_app;

COMMIT;
