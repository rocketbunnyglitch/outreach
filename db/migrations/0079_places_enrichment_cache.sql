-- Google Places enrichment cache.
--
-- The Halloween 2025 import (and any future bulk venue ingest)
-- resolves (name, city) → Google Places lookup → full venue
-- record (place_id, formatted address, phone, website, lat/lng,
-- rating). Each Google call costs money — caching by the
-- normalized lookup key for 30 days means a re-import is free.
--
-- The cache is also useful for the "Suggest venues" + "Paste
-- Maps URL" affordances. They populate this table, and the
-- import + future operator searches read from it before
-- spending on another lookup.
--
--   lookup_key       text NOT NULL UNIQUE — normalized
--                    "<city_id>::<lower(name)>". Includes
--                    city_id so the same venue name in two
--                    cities resolves to two distinct rows.
--   city_id          uuid NOT NULL — denormalized for fast
--                    range scans during a per-city backfill
--   query_text       text NOT NULL — the exact text we sent
--                    to Google (debugging + audit)
--
--   resolved_place_id        text NULL — Google place_id when
--                            resolved; NULL when "no match found"
--                            cached
--   resolved_name            text NULL
--   resolved_address         text NULL
--   resolved_phone_e164      text NULL
--   resolved_website         text NULL
--   resolved_lat             double precision NULL
--   resolved_lng             double precision NULL
--   resolved_rating          numeric(2,1) NULL
--   resolved_user_rating_count integer NULL
--   resolved_types           text[] NULL DEFAULT '{}'
--
--   resolved_at      timestamptz NOT NULL DEFAULT now()
--                    — also used as the cache-staleness clock
--   confidence       text NOT NULL DEFAULT 'unknown'
--                    — 'high' (single exact match),
--                      'medium' (top text-search result),
--                      'low' (used a fallback strategy),
--                      'none' (Google returned nothing —
--                              caller should NOT retry within
--                              the 30-day window),
--                      'unknown' (legacy / not yet classified)
--
-- Idempotent (IF NOT EXISTS). No backfill — entries materialize
-- on first lookup.

CREATE TABLE IF NOT EXISTS places_enrichment_cache (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lookup_key                  text NOT NULL UNIQUE,
  city_id                     uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  query_text                  text NOT NULL,
  resolved_place_id           text,
  resolved_name               text,
  resolved_address            text,
  resolved_phone_e164         text,
  resolved_website            text,
  resolved_lat                double precision,
  resolved_lng                double precision,
  resolved_rating             numeric(2,1),
  resolved_user_rating_count  integer,
  resolved_types              text[] NOT NULL DEFAULT '{}',
  resolved_at                 timestamptz NOT NULL DEFAULT now(),
  confidence                  text NOT NULL DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS places_enrichment_cache_city_idx
  ON places_enrichment_cache (city_id, resolved_at DESC);

CREATE INDEX IF NOT EXISTS places_enrichment_cache_place_id_idx
  ON places_enrichment_cache (resolved_place_id)
  WHERE resolved_place_id IS NOT NULL;
