-- =========================================================================
-- 0003_halloween_model.sql
--
-- Adds Halloween-aware semantics to the event model. The generic "city →
-- date+slot → venues" model isn't expressive enough for the multi-crawl
-- operating reality:
--
--   * 3 Friday Night crawls share the same middle venues
--   * Each crawl has its own wristband + final venue
--   * Operators care about ticket count, not just revenue
--
-- This migration is ADDITIVE — existing columns and behaviors are
-- preserved. New fields are nullable so existing rows aren't broken.
--
-- Schema additions:
--   1. day_part enum (thursday_night, friday_night, saturday_day, ...)
--   2. events: day_part, crawl_number, ticket_sales_count, starts_at,
--      ends_at, route_label, eventbrite_url, middle_venue_group_id
--   3. middle_venue_groups table — a collection of venues that play the
--      "middle" role across multiple crawls (e.g. "Friday Middle Group A"
--      shared by Fri #1, Fri #2, Fri #3)
--   4. middle_venue_group_members — venue × middle_venue_group with the
--      same per-row state as a venue_event (status, slot times, drink
--      specials, etc.)
--
-- After this migration:
--   * An event with middle_venue_group_id IS NULL falls back to direct
--     venue_events with role='middle' (legacy behavior, still works)
--   * An event with middle_venue_group_id SET inherits its middle venues
--     from the group. Wristband + final venues are still on venue_events.
-- =========================================================================

-- =========================================================================
-- day_part enum
-- =========================================================================
CREATE TYPE day_part AS ENUM (
  'thursday_night',
  'friday_night',
  'saturday_day',
  'saturday_night',
  'sunday_day',
  'sunday_night',
  'other'
);

-- =========================================================================
-- events: new columns
-- =========================================================================
ALTER TABLE events
  ADD COLUMN day_part day_part,
  ADD COLUMN crawl_number smallint,
  ADD COLUMN ticket_sales_count integer NOT NULL DEFAULT 0,
  ADD COLUMN starts_at timestamptz,
  ADD COLUMN ends_at timestamptz,
  ADD COLUMN route_label text,
  ADD COLUMN eventbrite_url text;

-- A crawl number is meaningless without a daypart — index together.
-- This is partial (only when both are set) so legacy events without daypart
-- don't all collide on day_part=NULL.
CREATE INDEX events_daypart_crawl_idx
  ON events(city_campaign_id, day_part, crawl_number)
  WHERE day_part IS NOT NULL;

CREATE INDEX events_ticket_sales_idx ON events(ticket_sales_count);

-- =========================================================================
-- middle_venue_groups
-- =========================================================================
CREATE TABLE middle_venue_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  city_campaign_id uuid NOT NULL REFERENCES city_campaigns(id) ON DELETE CASCADE,

  name text NOT NULL,
  -- e.g. "Friday Middle Group A", "Saturday Day Group"

  day_part day_part,
  -- Which daypart this group is meant for. Optional — a group could be
  -- reused across dayparts if the operator wants.

  status text NOT NULL DEFAULT 'planning',
  -- planning | active | confirmed | cancelled (free-text for now; can
  -- enum-ify later if patterns stabilize)

  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX middle_venue_groups_cc_idx ON middle_venue_groups(city_campaign_id);
CREATE INDEX middle_venue_groups_daypart_idx ON middle_venue_groups(day_part);
CREATE INDEX middle_venue_groups_archived_idx ON middle_venue_groups(archived_at)
  WHERE archived_at IS NULL;

-- =========================================================================
-- middle_venue_group_members — venue × group
-- =========================================================================
CREATE TABLE middle_venue_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  middle_venue_group_id uuid NOT NULL
    REFERENCES middle_venue_groups(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL
    REFERENCES venues(id) ON DELETE RESTRICT,

  -- Same status enum the venue_events table uses. Keeping it text here to
  -- avoid coupling — if venue_event_status changes we don't want this to
  -- silently follow.
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

CREATE INDEX middle_venue_group_members_group_idx
  ON middle_venue_group_members(middle_venue_group_id);
CREATE INDEX middle_venue_group_members_venue_idx
  ON middle_venue_group_members(venue_id);

-- =========================================================================
-- events.middle_venue_group_id (added last so the FK target exists)
-- =========================================================================
ALTER TABLE events
  ADD COLUMN middle_venue_group_id uuid
    REFERENCES middle_venue_groups(id) ON DELETE SET NULL;

CREATE INDEX events_middle_group_idx ON events(middle_venue_group_id)
  WHERE middle_venue_group_id IS NOT NULL;

-- =========================================================================
-- Triggers on new tables (touch_updated_at + bump_version + audit)
-- =========================================================================

CREATE TRIGGER middle_venue_groups_touch_updated_at BEFORE UPDATE ON middle_venue_groups
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER middle_venue_groups_bump_version BEFORE UPDATE ON middle_venue_groups
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER middle_venue_groups_audit AFTER INSERT OR UPDATE OR DELETE ON middle_venue_groups
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER middle_venue_group_members_touch_updated_at BEFORE UPDATE ON middle_venue_group_members
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER middle_venue_group_members_bump_version BEFORE UPDATE ON middle_venue_group_members
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER middle_venue_group_members_audit AFTER INSERT OR UPDATE OR DELETE ON middle_venue_group_members
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
