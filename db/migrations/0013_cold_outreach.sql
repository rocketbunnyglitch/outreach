-- =========================================================================
-- 0013_cold_outreach.sql
--
-- Per spec: each city sheet has a Cold Outreach table tracking venues
-- we're emailing/calling but haven't booked yet. Columns: venue, email,
-- ZeroBounce status, phone, outreach status, assigned, notes.
--
-- ZeroBounce status comes from the existing email_validations table
-- (already keyed by email). No duplication.
--
-- "Outreach status" is operator-managed lifecycle, separate from
-- venue_events.status (which applies once a venue is in a crawl slot).
-- =========================================================================

-- Enum mirrors the spec's allowed statuses
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cold_outreach_status') THEN
    CREATE TYPE cold_outreach_status AS ENUM (
      'not_contacted',
      'email_sent',
      'follow_up_due',
      'called',
      'voicemail',
      'no_answer',
      'interested',
      'declined',
      'bad_email',
      'wrong_number',
      'do_not_contact'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS cold_outreach_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  /**
   * Scoped per (city_campaign, venue). Same venue in two campaigns
   * gets two cold_outreach_entries rows so each campaign's lifecycle
   * is independent.
   */
  city_campaign_id uuid NOT NULL REFERENCES city_campaigns(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,

  status cold_outreach_status NOT NULL DEFAULT 'not_contacted',

  /** Operator who's chasing this lead. */
  assigned_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,

  /** Free-text remarks; inline-edited in the cold outreach table. */
  remarks text,

  /** When the last meaningful interaction happened (email, call, etc.). */
  last_touch_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  archived_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS cold_outreach_entries_cc_venue_unique
  ON cold_outreach_entries(city_campaign_id, venue_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS cold_outreach_entries_status_idx
  ON cold_outreach_entries(city_campaign_id, status)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS cold_outreach_entries_assigned_idx
  ON cold_outreach_entries(assigned_staff_id)
  WHERE archived_at IS NULL;

DROP TRIGGER IF EXISTS touch_cold_outreach_entries ON cold_outreach_entries;
CREATE TRIGGER touch_cold_outreach_entries
  BEFORE UPDATE ON cold_outreach_entries
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();

DROP TRIGGER IF EXISTS audit_cold_outreach_entries ON cold_outreach_entries;
CREATE TRIGGER audit_cold_outreach_entries
  AFTER INSERT OR UPDATE OR DELETE ON cold_outreach_entries
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
