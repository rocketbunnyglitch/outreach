-- Migration 0032 — Crawl hosts (up to 2 per crawl) + host_kind enum
--
-- Operator: "there can be up to 2 hosts per crawl." A host is either an
-- internal_host or an external_host (host_type discriminates; exactly
-- one of the *_host_id columns is set, enforced in the app). slot (1|2)
-- + the unique(event_id, slot) index cap a crawl at two hosts.
--
-- Powers crawl-matrix host classification (internal/external/none) and
-- the host badge on the crawl table.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'host_kind') THEN
    CREATE TYPE host_kind AS ENUM ('internal', 'external');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS crawl_hosts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  host_type         host_kind NOT NULL,
  internal_host_id  uuid REFERENCES internal_hosts(id) ON DELETE CASCADE,
  external_host_id  uuid REFERENCES external_hosts(id) ON DELETE CASCADE,
  slot              smallint NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS crawl_hosts_event_slot_unique
  ON crawl_hosts (event_id, slot);

CREATE INDEX IF NOT EXISTS crawl_hosts_event_idx ON crawl_hosts (event_id);
