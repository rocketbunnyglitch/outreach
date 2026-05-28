-- Migration 0034 — Event submission sites (per-city)
--
-- Operator session-12 P3: event-submission tab. Per-city list of the
-- sites we submit each event/crawl to (Eventbrite, local listings,
-- etc.), with the ability to add sites and mark them submitted.

CREATE TABLE IF NOT EXISTS event_submission_sites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id      uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name         text NOT NULL,
  url          text,
  notes        text,
  submitted    boolean NOT NULL DEFAULT false,
  submitted_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_by   uuid,
  archived_at  timestamptz
);

CREATE INDEX IF NOT EXISTS event_submission_sites_city_idx
  ON event_submission_sites (city_id)
  WHERE archived_at IS NULL;
