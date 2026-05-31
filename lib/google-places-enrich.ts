import "server-only";

/**
 * Google Places enrichment — resolve a venue name + city into a
 * full Google Place record with placeId, formatted address, lat/lng,
 * phone, website, and rating.
 *
 * Pipeline:
 *   1. Compute normalized lookup_key = "<city_id>::<lower(name)>"
 *   2. Read places_enrichment_cache. If a fresh hit exists (within
 *      CACHE_TTL_DAYS), return it. Counts negative results too —
 *      a confidence='none' row means "Google has nothing for this,
 *      don't re-bill for 30 days."
 *   3. On miss: call textSearchPlaces with a city-biased query,
 *      take the top result, fetch full details via fetchPlaceDetails,
 *      write the result (positive OR negative) into the cache, and
 *      return it.
 *
 * Cost characteristics (Google Places API, May 2026):
 *   - textSearch:    $0.032 per call
 *   - placeDetails:  $0.017 per call
 *   - Per enrichment (cache miss): ~$0.049
 *   - Per enrichment (cache hit):  $0
 *
 * For the Halloween 2025 import:
 *   - ~4300 unique venues across 114 cities → ~$210 first run
 *   - Re-imports: $0 (cache holds for 30 days)
 *
 * Concurrency:
 *   - Caller-supplied; this module does NOT enforce parallelism
 *     limits. The import action wraps batched calls in p-limit
 *     to stay under Google's 100 QPS quota.
 *
 * Failure modes (all return null + cache the miss):
 *   - GOOGLE_MAPS_API_KEY unset → null (no cache write)
 *   - textSearch returns 0 results → cache with confidence='none'
 *   - textSearch returns a result but placeDetails fails →
 *     cache with confidence='low' and whatever fields we got
 *   - Network timeout / 5xx → null (no cache write — retry-friendly)
 */

import { cities, placesEnrichmentCache } from "@/db/schema";
import { db } from "@/lib/db";
import { fetchPlaceDetails, isGoogleMapsConfigured, textSearchPlaces } from "@/lib/google-places";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";

const CACHE_TTL_DAYS = 30;

export type EnrichConfidence = "high" | "medium" | "low" | "none" | "unknown";

export interface EnrichedVenue {
  placeId: string | null;
  /** Formatted name from Google (e.g. "The Boom Boom Room"). May
   *  differ from the input — that's the point. */
  name: string | null;
  address: string | null;
  /** Phone in international E.164 format when Google has it,
   *  otherwise the national format. Null when no phone is on the
   *  Google profile. */
  phoneE164: string | null;
  website: string | null;
  lat: number | null;
  lng: number | null;
  googleRating: number | null;
  userRatingCount: number | null;
  /** Google place types — useful for auto-tagging venue_type. */
  types: string[];
  confidence: EnrichConfidence;
  /** True when the result came from the cache (no Google call). */
  fromCache: boolean;
}

/**
 * Normalize a name for the lookup key. Trims, lowercases, and
 * collapses internal whitespace. The same normalization happens
 * on every call so re-querying with stylistic variants (" The
 * Boom  Boom Room ") still hits the cache.
 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildLookupKey(cityId: string, name: string): string {
  return `${cityId}::${normalizeName(name)}`;
}

function isCacheFresh(resolvedAt: Date): boolean {
  const ageMs = Date.now() - resolvedAt.getTime();
  return ageMs < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

function rowToEnriched(row: typeof placesEnrichmentCache.$inferSelect): EnrichedVenue {
  return {
    placeId: row.resolvedPlaceId,
    name: row.resolvedName,
    address: row.resolvedAddress,
    phoneE164: row.resolvedPhoneE164,
    website: row.resolvedWebsite,
    lat: row.resolvedLat,
    lng: row.resolvedLng,
    googleRating: row.resolvedRating !== null ? Number(row.resolvedRating) : null,
    userRatingCount: row.resolvedUserRatingCount,
    types: row.resolvedTypes ?? [],
    confidence: row.confidence as EnrichConfidence,
    fromCache: true,
  };
}

interface EnrichInput {
  /** The venue name as it appears in the source data. */
  name: string;
  /** The city's ID in our DB. The lookup key uses this so the
   *  same name in two cities resolves to two distinct rows. */
  cityId: string;
}

/**
 * Resolve (name, cityId) to an EnrichedVenue. Cache-first.
 *
 * Returns null only when GOOGLE_MAPS_API_KEY is unset or when a
 * network call fails outright (timeout, 5xx). In those cases the
 * caller can retry later — nothing is cached.
 *
 * A confidence='none' result is NOT null — it's a cached miss
 * with all detail fields blank. Callers that want to fall back
 * to "create a stub venue with just the name" should treat
 * confidence='none' as "Google has nothing, do your fallback."
 */
export async function enrichVenueByNameAndCity(input: EnrichInput): Promise<EnrichedVenue | null> {
  const cityId = input.cityId;
  const name = input.name?.trim();
  if (!name) return null;
  if (!isGoogleMapsConfigured()) return null;

  const lookupKey = buildLookupKey(cityId, name);

  // ---------------- 1. Cache lookup ----------------
  const existing = await db
    .select()
    .from(placesEnrichmentCache)
    .where(eq(placesEnrichmentCache.lookupKey, lookupKey))
    .limit(1)
    .then((r) => r[0]);

  if (existing && isCacheFresh(existing.resolvedAt)) {
    return rowToEnriched(existing);
  }

  // ---------------- 2. City context for bias ----------------
  // The text search benefits from a bias point + radius so e.g.
  // "Brewery" in Toronto doesn't pull matches in Toronto, Ohio.
  // We also build "{name} {city_name}" as the search text — that
  // works well empirically for Places text search.
  const cityRow = await db
    .select({
      id: cities.id,
      name: cities.name,
      // PostGIS geography(point): grab lat/lng via ST_X/ST_Y on the
      // geometry cast. The location column is geography(point); we
      // need raw coordinates for the bias circle.
      location: cities.location,
    })
    .from(cities)
    .where(eq(cities.id, cityId))
    .limit(1)
    .then((r) => r[0]);

  if (!cityRow) {
    logger.warn({ cityId }, "enrichVenue: city not found");
    return null;
  }

  // Pull lat/lng off the geography point — Drizzle returns it as
  // a WKB hex string; we use a raw SQL fallback. To keep this
  // simple + robust, query ST_Y/ST_X separately.
  const { sql } = await import("drizzle-orm");
  const coordRow = await db
    .select({
      lat: sql<number | null>`ST_Y(${cities.location}::geometry)`,
      lng: sql<number | null>`ST_X(${cities.location}::geometry)`,
    })
    .from(cities)
    .where(eq(cities.id, cityId))
    .limit(1)
    .then((r) => r[0]);

  const cityLat = coordRow?.lat ?? null;
  const cityLng = coordRow?.lng ?? null;
  const bias =
    cityLat != null && cityLng != null ? { lat: cityLat, lng: cityLng, radiusM: 25000 } : undefined;

  const queryText = `${name} ${cityRow.name}`;

  // ---------------- 3. Google text search ----------------
  const startedAt = Date.now();
  const candidates = await textSearchPlaces({
    query: queryText,
    bias,
    maxResults: 3,
  });
  const elapsedMs = Date.now() - startedAt;

  if (candidates.length === 0) {
    // Negative cache — Google has nothing. Avoid re-billing.
    await writeCacheRow({
      lookupKey,
      cityId,
      queryText,
      result: null,
      confidence: "none",
    });
    logger.info(
      { name, cityName: cityRow.name, elapsedMs },
      "enrichVenue: no results (negative-cached)",
    );
    return {
      placeId: null,
      name: null,
      address: null,
      phoneE164: null,
      website: null,
      lat: null,
      lng: null,
      googleRating: null,
      userRatingCount: null,
      types: [],
      confidence: "none",
      fromCache: false,
    };
  }

  const top = candidates[0];
  if (!top) {
    // Defensive — should never happen given length check above.
    return null;
  }

  // ---------------- 4. Place details fetch ----------------
  const details = await fetchPlaceDetails(top.placeId);
  if (!details) {
    // Text search worked but details didn't. Cache what we have
    // with low confidence.
    const partial: EnrichedVenue = {
      placeId: top.placeId,
      name: top.name,
      address: null,
      phoneE164: null,
      website: null,
      lat: top.lat,
      lng: top.lng,
      googleRating: top.rating,
      userRatingCount: top.userRatingCount,
      types: [],
      confidence: "low",
      fromCache: false,
    };
    await writeCacheRow({
      lookupKey,
      cityId,
      queryText,
      result: partial,
      confidence: "low",
    });
    return partial;
  }

  // ---------------- 5. Pick confidence band ----------------
  // - 'high' when text search returned exactly one match AND the
  //   normalized names look close. We don't need to be picky on
  //   the second condition because the city bias already filters
  //   most far-flung matches.
  // - 'medium' otherwise.
  const confidence: EnrichConfidence =
    candidates.length === 1 ||
    normalizeName(details.name).startsWith(normalizeName(name).slice(0, 8))
      ? "high"
      : "medium";

  const enriched: EnrichedVenue = {
    placeId: details.placeId,
    name: details.name,
    address: details.address,
    phoneE164: details.phone,
    website: details.website,
    lat: details.lat,
    lng: details.lng,
    googleRating: details.rating,
    userRatingCount: details.userRatingCount,
    types: details.types ?? [],
    confidence,
    fromCache: false,
  };

  await writeCacheRow({
    lookupKey,
    cityId,
    queryText,
    result: enriched,
    confidence,
  });

  logger.info(
    {
      name,
      cityName: cityRow.name,
      placeId: enriched.placeId,
      confidence,
      elapsedMs,
    },
    "enrichVenue: resolved",
  );

  return enriched;
}

/**
 * Cache writer — upserts by lookup_key. Stores both positive and
 * negative results. Called by the resolver; not exported.
 */
async function writeCacheRow(opts: {
  lookupKey: string;
  cityId: string;
  queryText: string;
  result: EnrichedVenue | null;
  confidence: EnrichConfidence;
}): Promise<void> {
  try {
    const values = {
      lookupKey: opts.lookupKey,
      cityId: opts.cityId,
      queryText: opts.queryText,
      resolvedPlaceId: opts.result?.placeId ?? null,
      resolvedName: opts.result?.name ?? null,
      resolvedAddress: opts.result?.address ?? null,
      resolvedPhoneE164: opts.result?.phoneE164 ?? null,
      resolvedWebsite: opts.result?.website ?? null,
      resolvedLat: opts.result?.lat ?? null,
      resolvedLng: opts.result?.lng ?? null,
      // numeric column — Drizzle accepts string or number; pass
      // the number as a string to avoid precision drift.
      resolvedRating:
        opts.result?.googleRating != null ? opts.result.googleRating.toFixed(1) : null,
      resolvedUserRatingCount: opts.result?.userRatingCount ?? null,
      resolvedTypes: opts.result?.types ?? [],
      resolvedAt: new Date(),
      confidence: opts.confidence,
    };

    await db
      .insert(placesEnrichmentCache)
      .values(values)
      .onConflictDoUpdate({
        target: placesEnrichmentCache.lookupKey,
        set: {
          queryText: values.queryText,
          resolvedPlaceId: values.resolvedPlaceId,
          resolvedName: values.resolvedName,
          resolvedAddress: values.resolvedAddress,
          resolvedPhoneE164: values.resolvedPhoneE164,
          resolvedWebsite: values.resolvedWebsite,
          resolvedLat: values.resolvedLat,
          resolvedLng: values.resolvedLng,
          resolvedRating: values.resolvedRating,
          resolvedUserRatingCount: values.resolvedUserRatingCount,
          resolvedTypes: values.resolvedTypes,
          resolvedAt: values.resolvedAt,
          confidence: values.confidence,
        },
      });
  } catch (err) {
    // Cache failure is NEVER fatal — log and proceed. Worst case
    // we re-bill on the next call. The result is still returned
    // to the caller.
    logger.warn({ err, lookupKey: opts.lookupKey }, "places enrichment cache write failed");
  }
}

// =========================================================================
// Bulk resolver — used by phase-3 import
// =========================================================================

export interface BulkEnrichInput extends EnrichInput {
  /** Caller-supplied reference id (e.g. xlsx row index). Passed
   *  through to the result so the caller can correlate back. */
  ref?: string;
}

export interface BulkEnrichResult extends EnrichedVenue {
  ref?: string;
  inputName: string;
  inputCityId: string;
}

/**
 * Resolve many venues serially. Serial is intentional — the import
 * action wraps batches in its own concurrency control so we don't
 * stack two parallelism layers.
 *
 * Each lookup is independent: a failure on one entry doesn't stop
 * the rest. Failed lookups (null return from enrichVenueByNameAndCity)
 * are filtered OUT of the result array — the caller checks
 * `result.length < input.length` to detect skips.
 */
export async function enrichVenuesBulk(input: BulkEnrichInput[]): Promise<BulkEnrichResult[]> {
  const out: BulkEnrichResult[] = [];
  for (const item of input) {
    const result = await enrichVenueByNameAndCity({
      name: item.name,
      cityId: item.cityId,
    });
    if (result === null) continue; // network failure; skip
    out.push({
      ...result,
      ref: item.ref,
      inputName: item.name,
      inputCityId: item.cityId,
    });
  }
  return out;
}
