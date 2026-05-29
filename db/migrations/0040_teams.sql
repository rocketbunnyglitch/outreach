-- 0040_teams.sql
-- Establishes the team layer.
--
-- The crawl-engine has always been a single-tenant app (BarCrawlConnect)
-- with no team concept on the schema. Operator decided to add the
-- 'team' abstraction so the inbox surface can be filtered "all team
-- accounts" vs "my accounts" and so future multi-tenancy is not
-- blocked at the schema level.
--
-- A single 'BarCrawlConnect' team is seeded. Every existing user and
-- connected_accounts row will be backfilled to this team in the next
-- migrations.
--
-- Schema kept intentionally minimal — just id + name + slug + audit.
-- More columns can be added later when there's a real second team.

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS teams_slug_unique ON teams (slug);

-- Seed the single default team. Fixed UUID so downstream migrations
-- can reference it deterministically. Generated once, hard-coded
-- here on purpose — re-running this migration is a no-op via
-- ON CONFLICT.
INSERT INTO teams (id, name, slug)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'BarCrawlConnect',
  'barcrawlconnect'
)
ON CONFLICT (id) DO NOTHING;
