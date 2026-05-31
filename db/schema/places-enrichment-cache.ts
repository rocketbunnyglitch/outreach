/**
 * places_enrichment_cache — Google Places lookup cache.
 *
 * Migration 0079. See db/migrations/0079_places_enrichment_cache.sql
 * for the full design rationale.
 *
 * One row per normalized lookup. The cache key is
 * `<city_id>::<lower(name)>` so the same venue name in two cities
 * resolves to two distinct rows. Negative results (Google returned
 * nothing) are cached with confidence='none' to avoid re-billing
 * for repeated misses within the 30-day window.
 *
 * Used by:
 *   - lib/google-places-enrich.ts (the resolver itself)
 *   - the Halloween 2025 import (phase 3)
 *   - future bulk venue ingest flows
 */

import {
  doublePrecision,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { idColumn } from "../types";
import { cities } from "./geography";

export const placesEnrichmentCache = pgTable(
  "places_enrichment_cache",
  {
    ...idColumn,

    /** Normalized lookup key — `<city_id>::<lower(name)>`. The
     *  resolver computes this deterministically; never relies on
     *  caller-side normalization. */
    lookupKey: text("lookup_key").notNull(),

    /** Denormalized for fast per-city scans during a backfill or
     *  cache-invalidation sweep. */
    cityId: uuid("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "cascade" }),

    /** The exact text we sent to Google. Stored for audit /
     *  debugging — never used for matching. */
    queryText: text("query_text").notNull(),

    /** Google place_id when resolved; NULL when "no match found"
     *  is cached (avoid re-billing for the next 30 days). */
    resolvedPlaceId: text("resolved_place_id"),
    resolvedName: text("resolved_name"),
    resolvedAddress: text("resolved_address"),
    resolvedPhoneE164: text("resolved_phone_e164"),
    resolvedWebsite: text("resolved_website"),
    resolvedLat: doublePrecision("resolved_lat"),
    resolvedLng: doublePrecision("resolved_lng"),
    /** Google rating (0-5, one decimal). Schema is numeric(2,1) so
     *  values like 4.5 round-trip cleanly. */
    resolvedRating: numeric("resolved_rating", { precision: 2, scale: 1 }),
    resolvedUserRatingCount: integer("resolved_user_rating_count"),
    /** Google place types (e.g. ["bar", "restaurant", "night_club"]).
     *  Empty array on miss. */
    resolvedTypes: text("resolved_types").array().notNull().default([]),

    /** When the resolver wrote this row. Also doubles as the
     *  staleness clock — anything older than 30 days is refreshed
     *  on next lookup. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),

    /** Confidence band:
     *   - 'high'    — exact single match
     *   - 'medium'  — took top result from text search
     *   - 'low'     — used a fallback strategy
     *   - 'none'    — Google returned nothing (negative cache)
     *   - 'unknown' — legacy / not yet classified
     */
    confidence: text("confidence").notNull().default("unknown"),
  },
  (table) => ({
    lookupKeyUnique: uniqueIndex("places_enrichment_cache_lookup_key_idx").on(table.lookupKey),
    cityResolvedIdx: index("places_enrichment_cache_city_idx").on(table.cityId, table.resolvedAt),
  }),
);
