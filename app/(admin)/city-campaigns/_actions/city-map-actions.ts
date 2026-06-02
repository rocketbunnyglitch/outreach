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
  resolveMapsUrlToPlace,
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
  /**
   * Operator-facing detail string when reason === 'google_error'.
   * Includes specific guidance like "key rejected (403) — referrer
   * restriction" so the operator knows where to fix it.
   */
  errorDetail?: string;
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
    return {
      ok: true,
      center: { lat, lng },
      radiusKm,
      places: [],
      reason: "google_error",
      errorDetail: parseGooglePlacesError(err),
    };
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

  // Dedup: a venue is uniquely keyed on google_place_id (partial unique
  // index venues_google_place_id_unique spans ALL rows -- archived too).
  // The map flagging (fetchCityMapPlaces / reflagInDirectory) only counts
  // NON-archived venues as inDirectory, so an archived venue shows up as a
  // fresh, addable pin. If we then blind-INSERT it, we hit the unique
  // index and 500. So:
  //   - Look the place up INCLUDING archived rows.
  //   - If found archived, un-archive it (re-add == restore) so the map's
  //     "addable" state and the add behavior are coherent.
  //   - Only insert when truly absent, and guard the insert against a
  //     concurrent add with onConflictDoUpdate so a race can't 500.
  const existing = await db
    .select({ id: venues.id, archivedAt: venues.archivedAt })
    .from(venues)
    .where(eq(venues.googlePlaceId, opts.place.placeId))
    .limit(1);

  let venueId: string;
  if (existing[0]) {
    venueId = existing[0].id;
    if (existing[0].archivedAt !== null) {
      // Re-adding a place whose venue was archived: restore it so it
      // becomes a live directory entry again (matches the map's view
      // that this pin was addable / not in the directory).
      try {
        await withAuditContext(staff.id, async (tx) =>
          tx
            .update(venues)
            .set({ archivedAt: null, updatedBy: staff.id })
            .where(eq(venues.id, venueId)),
        );
      } catch (err) {
        logger.error({ err, venueId }, "addPlaceToCampaign: un-archive failed");
        return { ok: false, error: "Couldn't restore the archived venue." };
      }
    }
  } else {
    try {
      const created = await withAuditContext(staff.id, async (tx) =>
        tx
          .insert(venues)
          .values({
            cityId: opts.cityId,
            name: opts.place.name,
            googlePlaceId: opts.place.placeId,
            address: opts.place.address,
            phoneE164: opts.place.phone,
            websiteUrl: opts.place.website,
            location: { lng: opts.place.lng, lat: opts.place.lat },
            createdBy: staff.id,
            updatedBy: staff.id,
          })
          // Concurrent add of the same place_id (or an archived row we
          // missed by a hair) resolves to an update instead of a unique
          // violation. Un-archive in the same statement so re-add is
          // idempotent and never 500s.
          .onConflictDoUpdate({
            target: venues.googlePlaceId,
            set: { archivedAt: null, updatedBy: staff.id },
          })
          .returning({ id: venues.id }),
      );
      if (!created[0]) return { ok: false, error: "Insert returned no row." };
      venueId = created[0].id;
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

  try {
    revalidatePath(`/city-campaigns/${opts.cityCampaignId}`);
  } catch (err) {
    logger.warn({ err }, "addPlaceToCampaign: revalidate failed (non-fatal)");
  }
  try {
    publishRealtime({
      table: `cold-outreach-${opts.cityCampaignId}`,
      type: "insert",
      byStaffId: staff.id,
      byStaffName: staff.displayName ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "addPlaceToCampaign: realtime publish failed (non-fatal)");
  }

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

// =========================================================================
// addVenueFromMapsUrl — paste a Google Maps URL, get a venue in the
// directory + a cold-outreach entry on the campaign, all in one shot.
//
// Three URL shapes handled by parseGoogleMapsUrl + resolveShortMapsUrl
// in lib/google-places.ts:
//   - https://www.google.com/maps/place/... (place_id embedded)
//   - https://goo.gl/maps/... (short link; HEAD-redirect-resolved)
//   - https://maps.app.goo.gl/... (mobile share link; same resolver)
//
// On success: name, address, phone, website, lat/lng, types persisted
// onto the venue + a cold-outreach entry created in the campaign.
//
// Failure cases (returned as { ok: false, error }):
//   - URL doesn't parse / isn't a Google Maps URL
//   - URL is coord-only (no place_id) — operator should re-share after
//     tapping the specific business on the map
//   - Places Details lookup fails (rate limit, expired place id)
//   - Maps API key not configured
// =========================================================================

export async function addVenueFromMapsUrl(opts: {
  cityCampaignId: string;
  url: string;
}): Promise<{
  ok: boolean;
  venueId?: string;
  /** What we resolved — surfaced so the UI can show a preview before
      navigating away. Populated on success only. */
  resolved?: {
    name: string;
    address: string | null;
    phone: string | null;
    website: string | null;
  };
  error?: string;
}> {
  await requireStaff();

  if (!isGoogleMapsConfigured()) {
    return { ok: false, error: "Google Maps API key isn't configured." };
  }

  const url = opts.url.trim();
  if (!url) return { ok: false, error: "Paste a Google Maps URL first." };

  // Resolve the city to attach the venue to
  const cityRows = await db.execute<{ city_id: string }>(sql`
    SELECT cc.city_id FROM city_campaigns cc
    WHERE cc.id = ${opts.cityCampaignId}
    LIMIT 1
  `);
  const cityList: Array<{ city_id: string }> = Array.isArray(cityRows)
    ? (cityRows as unknown as Array<{ city_id: string }>)
    : ((cityRows as unknown as { rows: Array<{ city_id: string }> }).rows ?? []);
  const cityId = cityList[0]?.city_id;
  if (!cityId) return { ok: false, error: "City campaign not found." };

  // Resolve the URL → discriminated result; specific error per shape.
  const result = await resolveMapsUrlToPlace(url);

  if (result.kind === "not_a_maps_url") {
    return { ok: false, error: "That doesn't look like a Google Maps URL." };
  }
  if (result.kind === "search_url") {
    return {
      ok: false,
      error: `That's a Google Maps SEARCH ("${result.query}"), not a specific venue. Either (a) tap a venue tile in the search results and re-share, or (b) use the city map below — it can pan-and-search the same area without needing a URL.`,
    };
  }
  if (result.kind === "coord_only") {
    return {
      ok: false,
      error:
        "That URL only contains map coordinates, not a venue. In the Maps app, tap the specific venue tile first, then share — the new link will include the venue's identity.",
    };
  }
  if (result.kind === "cid_unresolved") {
    return {
      ok: false,
      error:
        result.lat != null && result.lng != null
          ? "We recognized the venue ID but couldn't fetch its details from Google. Try the city map's 'Search this area' feature instead — your venue should show up in the pins."
          : "We recognized the venue ID but couldn't fetch its details from Google. Try sharing again from the Maps app.",
    };
  }
  if (result.kind === "lookup_failed") {
    return {
      ok: false,
      error:
        "Google Maps returned no details for that venue. The Maps API key may be restricted; check Cloud Console.",
    };
  }

  const place = result.place;
  if (place.lat == null || place.lng == null) {
    return {
      ok: false,
      error: "Resolved the URL but Google didn't return coords for the venue.",
    };
  }

  // Hand off to the existing add-to-campaign flow
  const addResult = await addPlaceToCampaign({
    cityCampaignId: opts.cityCampaignId,
    cityId,
    place: {
      placeId: place.placeId,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      address: place.address,
      phone: place.phone,
      website: place.website,
      rating: place.rating,
      userRatingCount: place.userRatingCount,
      types: place.types,
    },
  });

  if (!addResult.ok) return { ok: false, error: addResult.error };
  return {
    ok: true,
    venueId: addResult.venueId,
    resolved: {
      name: place.name,
      address: place.address,
      phone: place.phone,
      website: place.website,
    },
  };
}

/**
 * Translate a Google Places error into operator-facing copy that
 * points at the fix. Shared between the city-map and discover flows.
 *
 * Never leak stack traces; safe to display in the UI.
 *
 * See CLAUDE.md §12.4 — no silent failures: every Places error
 * surfaces a specific reason the operator can act on.
 */
function parseGooglePlacesError(err: unknown): string {
  const e = err as { status?: number; message?: string; code?: string };
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return "GOOGLE_MAPS_API_KEY is not set on the server. Add it to /var/www/outreach/.env and restart.";
  }
  if (typeof e?.status === "number") {
    if (e.status === 403) {
      return "Google rejected the key (403). Either the HTTP referrer restriction in Cloud Console doesn't include outreach.barcrawlconnect.com, OR Places API (New) isn't enabled.";
    }
    if (e.status === 429) {
      return "Google quota/rate-limit hit (429).";
    }
    if (e.status === 401) {
      return "Google rejected the key (401). Verify the key string in .env matches the active key in Cloud Console.";
    }
    if (e.status >= 500) {
      return `Google server error (${e.status}). Probably transient.`;
    }
  }
  if (e?.message && /(ECONNREFUSED|ENOTFOUND|fetch failed|ETIMEDOUT)/i.test(e.message)) {
    return `Network error: ${e.message}`;
  }
  if (e?.message) return e.message.slice(0, 200);
  return "Unknown error.";
}
