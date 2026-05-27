"use server";

/**
 * fetchCityMapPlaces — returns every bar / nightclub / restaurant Google
 * Places knows about within radius of the city's center, each flagged
 * with whether it's already in our venues directory.
 *
 * Used by the <CityVenueMap> component at the bottom of /city-campaigns/[id].
 * Operators see the city, can pin-tap any venue, and add it directly.
 *
 * Caching:
 *   Redis key 'city-map:<cityId>:<radiusKm>' with 24h TTL. Operator-facing
 *   pan/zoom calls re-search if center+radius drifts; the cache key is
 *   per (cityId, radiusKm) which covers the default 'show me my city' load.
 *
 * Cost guard:
 *   ~$32/1k Places Nearby calls. 24h TTL keeps each (city, radius) combo
 *   at most 1 call/day. A team of 5 staff opening 5 city sheets each
 *   per day = 25 calls/day = $0.80/day worst case.
 *
 * Caveats:
 *   - includedTypes hardcoded to bar/night_club/restaurant.
 *   - maxResults 60 (we paginate up to 3 pages × 20 = 60 to give a
 *     decent map density without hammering the API).
 */

import { venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  isGoogleMapsConfigured,
  nearbyVenueSearch,
  textSearchPlaces,
  weightedCenter,
} from "@/lib/google-places";
import { logger } from "@/lib/logger";
import { getRedis } from "@/lib/redis";
import { sql } from "drizzle-orm";

const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24h
const MAX_RESULTS = 60; // 3 pages × 20 from Places Nearby

export interface CityMapPlace {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  userRatingCount: number | null;
  types: string[];
  /** Already a venue in our directory. */
  inDirectory: boolean;
  /** The venue id if inDirectory; null otherwise. */
  venueId: string | null;
}

export interface CityMapResult {
  ok: boolean;
  /** City lat/lng we centered on. */
  center: { lat: number; lng: number } | null;
  /** Radius searched, in km. */
  radiusKm: number;
  places: CityMapPlace[];
  /** Why this returned empty, when applicable. */
  reason?:
    | "not_configured"
    | "no_city_coords"
    | "google_returned_nothing"
    | "google_error"
    | "unknown";
  cached?: boolean;
}

export async function fetchCityMapPlaces(opts: {
  cityCampaignId: string;
  /** Override the default 8km if the operator zooms wider. */
  radiusKm?: number;
  /** Override the city's recorded center — used by "Search this area" after
      the operator pans the map. If unset, falls back to the city's lat/lng. */
  centerLat?: number;
  centerLng?: number;
}): Promise<CityMapResult> {
  await requireStaff();

  if (!isGoogleMapsConfigured()) {
    return { ok: true, center: null, radiusKm: 0, places: [], reason: "not_configured" };
  }

  const radiusKm = clamp(opts.radiusKm ?? 8, 1, 25);
  const hasOverride = opts.centerLat != null && opts.centerLng != null;

  // Resolve city coords. Always needed (we key the dedup join on cityId).
  const cityRows = await db.execute<{
    city_id: string;
    lat: number | null;
    lng: number | null;
  }>(sql`
    SELECT c.id AS city_id,
           ST_Y(c.location::geometry) AS lat,
           ST_X(c.location::geometry) AS lng
    FROM city_campaigns cc
    JOIN cities c ON c.id = cc.city_id
    WHERE cc.id = ${opts.cityCampaignId}
    LIMIT 1
  `);
  const cityList: Array<{ city_id: string; lat: number | null; lng: number | null }> =
    Array.isArray(cityRows)
      ? (cityRows as unknown as Array<{ city_id: string; lat: number | null; lng: number | null }>)
      : ((
          cityRows as unknown as {
            rows: Array<{ city_id: string; lat: number | null; lng: number | null }>;
          }
        ).rows ?? []);
  const cityRow = cityList[0];
  if (!cityRow) {
    return { ok: true, center: null, radiusKm, places: [], reason: "no_city_coords" };
  }
  // If no override AND no city coords, we can't search at all
  if (!hasOverride && (!cityRow.lat || !cityRow.lng)) {
    return { ok: true, center: null, radiusKm, places: [], reason: "no_city_coords" };
  }
  const cityId = cityRow.city_id;
  const lat = hasOverride ? (opts.centerLat as number) : (cityRow.lat as number);
  const lng = hasOverride ? (opts.centerLng as number) : (cityRow.lng as number);

  // Cache key includes whether this is a manual pan; pan-results bypass the
  // 24h city-center cache (operator wants live results when they explicitly
  // search a new area).
  const cacheKey = hasOverride ? null : `city-map:${cityId}:${radiusKm}`;
  if (cacheKey) {
    try {
      const cachedRaw = await getRedis().get(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as { places: CityMapPlace[] };
        return {
          ok: true,
          center: { lat, lng },
          radiusKm,
          places: await reflagInDirectory(cached.places, cityId),
          cached: true,
        };
      }
    } catch (err) {
      logger.warn({ err, cacheKey }, "city-map cache read failed; continuing without cache");
    }
  }

  // Fresh search
  let candidates: Awaited<ReturnType<typeof nearbyVenueSearch>>;
  try {
    candidates = await nearbyVenueSearch({
      lat,
      lng,
      radiusM: radiusKm * 1000,
      maxResults: MAX_RESULTS,
    });
  } catch (err) {
    logger.warn({ err, cityCampaignId: opts.cityCampaignId }, "city-map nearby search failed");
    return { ok: true, center: { lat, lng }, radiusKm, places: [], reason: "google_error" };
  }

  if (candidates.length === 0) {
    return {
      ok: true,
      center: { lat, lng },
      radiusKm,
      places: [],
      reason: "google_returned_nothing",
    };
  }

  // Materialize places + flag against the venues directory
  const placeIds = candidates.map((c) => c.placeId);
  const existing = await db.execute<{ id: string; google_place_id: string }>(sql`
    SELECT id, google_place_id FROM venues
    WHERE google_place_id IN ${placeIds}
      AND archived_at IS NULL
  `);
  const existingList: Array<{ id: string; google_place_id: string }> = Array.isArray(existing)
    ? (existing as unknown as Array<{ id: string; google_place_id: string }>)
    : ((existing as unknown as { rows: Array<{ id: string; google_place_id: string }> }).rows ??
      []);
  const directoryMap = new Map(existingList.map((r) => [r.google_place_id, r.id]));

  const places: CityMapPlace[] = candidates
    .filter((c) => c.lat != null && c.lng != null)
    .map((c) => ({
      placeId: c.placeId,
      name: c.name,
      lat: c.lat as number,
      lng: c.lng as number,
      address: c.address,
      phone: c.phone,
      website: c.website,
      rating: c.rating,
      userRatingCount: c.userRatingCount,
      types: c.types,
      inDirectory: directoryMap.has(c.placeId),
      venueId: directoryMap.get(c.placeId) ?? null,
    }));

  // Cache for 24h ONLY for city-center searches; pan-and-search-this-area
  // results aren't cached because operators want fresh results when they
  // explicitly target a new area.
  if (cacheKey) {
    try {
      const cachable = places.map(({ inDirectory: _i, venueId: _v, ...rest }) => rest);
      await getRedis().set(cacheKey, JSON.stringify({ places: cachable }), "EX", CACHE_TTL_SECONDS);
    } catch (err) {
      logger.warn({ err, cacheKey }, "city-map cache write failed");
    }
  }

  return { ok: true, center: { lat, lng }, radiusKm, places };
}

// =========================================================================
// Helpers
// =========================================================================

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Re-flag cached places by re-querying the venues table. The cache only
 * stores the Places API results — the in-directory state lives in our
 * DB and changes whenever an operator adds a venue.
 */
async function reflagInDirectory(
  cachedPlaces: Array<Omit<CityMapPlace, "inDirectory" | "venueId">>,
  _cityId: string,
): Promise<CityMapPlace[]> {
  if (cachedPlaces.length === 0) return [];
  const placeIds = cachedPlaces.map((p) => p.placeId);
  const existing = await db.execute<{ id: string; google_place_id: string }>(sql`
    SELECT id, google_place_id FROM venues
    WHERE google_place_id IN ${placeIds}
      AND archived_at IS NULL
  `);
  const list: Array<{ id: string; google_place_id: string }> = Array.isArray(existing)
    ? (existing as unknown as Array<{ id: string; google_place_id: string }>)
    : ((existing as unknown as { rows: Array<{ id: string; google_place_id: string }> }).rows ??
      []);
  const map = new Map(list.map((r) => [r.google_place_id, r.id]));
  return cachedPlaces.map((p) => ({
    ...p,
    inDirectory: map.has(p.placeId),
    venueId: map.get(p.placeId) ?? null,
  }));
}

// =========================================================================
// Single-place add — used when an operator clicks "Add to campaign" on a
// map pin. Mirrors acceptLeadSuggestions but for one place at a time.
// =========================================================================

import { coldOutreachEntries } from "@/db/schema";
import { withAuditContext } from "@/lib/db";
import { publishRealtime } from "@/lib/realtime-publish";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function addPlaceToCampaign(opts: {
  cityCampaignId: string;
  cityId: string;
  place: {
    placeId: string;
    name: string;
    lat: number;
    lng: number;
    address: string | null;
    phone: string | null;
    website: string | null;
    rating: number | null;
    userRatingCount: number | null;
    types: string[];
  };
}): Promise<{ ok: boolean; venueId?: string; error?: string }> {
  const { staff } = await requireStaff();

  // Dedup: if it already exists, just attach as cold-outreach entry
  const existing = await db
    .select({ id: venues.id })
    .from(venues)
    .where(eq(venues.googlePlaceId, opts.place.placeId))
    .limit(1);

  let venueId: string;
  if (existing[0]) {
    venueId = existing[0].id;
  } else {
    try {
      const [created] = await withAuditContext(staff.id, async (tx) =>
        tx
          .insert(venues)
          .values({
            cityId: opts.cityId,
            name: opts.place.name,
            googlePlaceId: opts.place.placeId,
            address: opts.place.address,
            location: { lng: opts.place.lng, lat: opts.place.lat },
            createdBy: staff.id,
            updatedBy: staff.id,
          })
          .returning({ id: venues.id }),
      );
      if (!created) return { ok: false, error: "Insert returned no row." };
      venueId = created.id;
    } catch (err) {
      logger.error({ err, place: opts.place }, "addPlaceToCampaign: venue insert failed");
      return { ok: false, error: "Couldn't create the venue." };
    }
  }

  // Attach to the campaign as a cold-outreach entry if not already there
  try {
    await db
      .insert(coldOutreachEntries)
      .values({
        cityCampaignId: opts.cityCampaignId,
        venueId,
        status: "not_contacted",
        assignedStaffId: staff.id,
      })
      .onConflictDoNothing();
  } catch (err) {
    logger.warn(
      { err, venueId, cityCampaignId: opts.cityCampaignId },
      "cold-outreach attach skipped",
    );
    // Not fatal — the venue exists; operator can attach manually if needed
  }

  revalidatePath(`/city-campaigns/${opts.cityCampaignId}`);
  publishRealtime({
    table: `cold-outreach-${opts.cityCampaignId}`,
    type: "insert",
    byStaffId: staff.id,
    byStaffName: staff.displayName ?? null,
  });

  return { ok: true, venueId };
}

// =========================================================================
// fetchCityMapBestCenter — finds the densest nightlife area in a city
// using Google Places Text Search, then returns the weighted center of
// the top results. The map uses this on first load instead of the city's
// recorded centroid (which is typically a town hall or post office).
//
// Strategy:
//   1. Run "bars in {city}" via Text Search with a 25km bias around the
//      city center (so we don't pull in matches from another country).
//   2. If <3 results, retry with "nightlife in {city}".
//   3. Compute the log-weighted center (log(userRatingCount) so a single
//      tiny review-less bar doesn't pull the map toward it).
//   4. Cache 7 days in Redis — the "where the bars are" doesn't shift.
//
// Cost: 1 Text Search call = $32/1k. 7-day cache → effectively free.
// =========================================================================

export interface BestCenterResult {
  ok: boolean;
  center: { lat: number; lng: number } | null;
  /** What we found — populated even on success so UI can show "found 12
      bars in this area" or similar. */
  candidatesCount: number;
  reason?: "not_configured" | "no_city_coords" | "no_results" | "google_error";
}

const BEST_CENTER_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days

export async function fetchCityMapBestCenter(opts: {
  cityCampaignId: string;
}): Promise<BestCenterResult> {
  await requireStaff();

  if (!isGoogleMapsConfigured()) {
    return { ok: true, center: null, candidatesCount: 0, reason: "not_configured" };
  }

  // Resolve the city's name + center coords. Name drives the Text Search
  // query; coords drive the locationBias so we don't get Toronto, OH.
  const cityRows = await db.execute<{
    city_id: string;
    name: string;
    lat: number | null;
    lng: number | null;
  }>(sql`
    SELECT c.id AS city_id,
           c.name,
           ST_Y(c.location::geometry) AS lat,
           ST_X(c.location::geometry) AS lng
    FROM city_campaigns cc
    JOIN cities c ON c.id = cc.city_id
    WHERE cc.id = ${opts.cityCampaignId}
    LIMIT 1
  `);
  const cityList: Array<{ city_id: string; name: string; lat: number | null; lng: number | null }> =
    Array.isArray(cityRows)
      ? (cityRows as unknown as Array<{
          city_id: string;
          name: string;
          lat: number | null;
          lng: number | null;
        }>)
      : ((
          cityRows as unknown as {
            rows: Array<{
              city_id: string;
              name: string;
              lat: number | null;
              lng: number | null;
            }>;
          }
        ).rows ?? []);
  const cityRow = cityList[0];
  if (!cityRow || !cityRow.lat || !cityRow.lng) {
    return { ok: true, center: null, candidatesCount: 0, reason: "no_city_coords" };
  }

  // Cache check
  const cacheKey = `city-map-best-center:${cityRow.city_id}`;
  try {
    const cachedRaw = await getRedis().get(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw) as BestCenterResult;
      return { ...cached, ok: true };
    }
  } catch (err) {
    logger.warn({ err, cacheKey }, "best-center cache read failed");
  }

  const bias = {
    lat: cityRow.lat,
    lng: cityRow.lng,
    radiusM: 25_000,
  };

  // Try "bars in {city}" first; fall back to "nightlife"
  const results = await textSearchPlaces({
    query: `bars in ${cityRow.name}`,
    bias,
    maxResults: 15,
  });
  if (results.length < 3) {
    const fallback = await textSearchPlaces({
      query: `nightlife in ${cityRow.name}`,
      bias,
      maxResults: 15,
    });
    // Merge unique by placeId
    const seen = new Set(results.map((r) => r.placeId));
    for (const p of fallback) {
      if (!seen.has(p.placeId)) {
        results.push(p);
        seen.add(p.placeId);
      }
    }
  }

  if (results.length === 0) {
    return { ok: true, center: null, candidatesCount: 0, reason: "no_results" };
  }

  const center = weightedCenter(results);
  if (!center) {
    return { ok: true, center: null, candidatesCount: results.length, reason: "no_results" };
  }

  const result: BestCenterResult = {
    ok: true,
    center,
    candidatesCount: results.length,
  };

  try {
    await getRedis().set(cacheKey, JSON.stringify(result), "EX", BEST_CENTER_CACHE_TTL);
  } catch (err) {
    logger.warn({ err, cacheKey }, "best-center cache write failed");
  }

  return result;
}
