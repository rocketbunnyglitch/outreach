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
import { isGoogleMapsConfigured, nearbyVenueSearch } from "@/lib/google-places";
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
}): Promise<CityMapResult> {
  await requireStaff();

  if (!isGoogleMapsConfigured()) {
    return { ok: true, center: null, radiusKm: 0, places: [], reason: "not_configured" };
  }

  const radiusKm = clamp(opts.radiusKm ?? 8, 1, 25);

  // Resolve city coords. The same query the suggester uses.
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
  if (!cityRow || !cityRow.lat || !cityRow.lng) {
    return { ok: true, center: null, radiusKm, places: [], reason: "no_city_coords" };
  }
  const cityId = cityRow.city_id;
  const lat = cityRow.lat;
  const lng = cityRow.lng;

  // Try cache
  const cacheKey = `city-map:${cityId}:${radiusKm}`;
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

  // Cache for 24h (without the inDirectory flag — we re-flag on read so
  // newly added venues immediately appear gray)
  try {
    const cachable = places.map(({ inDirectory: _i, venueId: _v, ...rest }) => rest);
    await getRedis().set(cacheKey, JSON.stringify({ places: cachable }), "EX", CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, cacheKey }, "city-map cache write failed");
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
