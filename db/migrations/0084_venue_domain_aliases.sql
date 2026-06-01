-- 0084_venue_domain_aliases.sql
--
-- Per-venue domain alias list for cross-domain sender matching.
--
-- venues.alternate_emails already covers "this exact address is also
-- Lavelle". This table covers the broader-stroke "anyone @ this DOMAIN
-- is part of Lavelle" case: a venue's manager often emails from a
-- parent-group domain (e.g. @taohospitalitygroup.com) that does not
-- match the venue's own site (lavellenyc.com). Recording the domain as
-- an alias lets the matcher attach those threads automatically.
--
-- (venue_id, domain) is unique: many domains per venue, but each domain
-- once per venue. A domain may repeat across venues when two venues
-- share a parent group (rare) -- the matcher surfaces all matches.
--
-- Idempotent (IF NOT EXISTS) so the runner can safely re-apply.

CREATE TABLE IF NOT EXISTS venue_domain_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owning venue. Cascade so aliases vanish with the venue.
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,

  -- Normalized host: lowercase, no leading "@", no path/port.
  domain text NOT NULL,

  -- Optional operator note explaining the relationship.
  notes text,

  created_at timestamptz NOT NULL DEFAULT NOW(),

  -- Who added it. SET NULL so removing a user keeps their aliases.
  created_by uuid REFERENCES users(id) ON DELETE SET NULL
);

-- Many domains per venue, each domain once per venue.
CREATE UNIQUE INDEX IF NOT EXISTS venue_domain_aliases_venue_domain_unique
  ON venue_domain_aliases (venue_id, domain);

-- Fast reverse lookup: given an inbound sender domain, find venues.
CREATE INDEX IF NOT EXISTS venue_domain_aliases_domain_idx
  ON venue_domain_aliases (domain);
