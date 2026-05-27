/**
 * Google Places API (New) client + dev mock.
 *
 * Endpoint: https://places.googleapis.com/v1/places:searchNearby
 * Docs: https://developers.google.com/maps/documentation/places/web-service/nearby-search
 *
 * Behavior:
 *   - When GOOGLE_MAPS_API_KEY is set, makes real API calls.
 *   - When unset, returns deterministic mock data so the discovery flow is
 *     fully testable in dev. Mock data is keyed off the city name so e.g.
 *     "Toronto" returns Toronto-flavored fake bars.
 *
 * Field mask: we request the minimum fields needed for the discovery flow.
 * Each request costs more per field — keeping the mask tight matters for
 * billing.
 */

import { env } from "./env";
import { logger } from "./logger";

export interface PlaceSearchInput {
  /** City latitude */
  lat: number;
  /** City longitude */
  lng: number;
  /** Search radius in meters. Google caps at 50000m. */
  radiusMeters: number;
  /** Place types to include. e.g. ["bar", "night_club", "restaurant"]. */
  includedTypes: string[];
  /** Max results per call (1-20). */
  maxResults?: number;
}

export interface DiscoveredPlace {
  googlePlaceId: string;
  name: string;
  formattedAddress: string | null;
  phoneE164: string | null;
  websiteUri: string | null;
  rating: number | null;
  userRatingCount: number | null;
  types: string[];
  location: { lat: number; lng: number } | null;
}

export interface PlaceSearchResult {
  places: DiscoveredPlace[];
  source: "google_places" | "mock";
}

/**
 * Searches nearby places. Returns mock data if no API key is configured.
 */
export async function searchNearbyPlaces(input: PlaceSearchInput): Promise<PlaceSearchResult> {
  if (!env.GOOGLE_MAPS_API_KEY) {
    logger.info(
      { lat: input.lat, lng: input.lng, types: input.includedTypes },
      "GOOGLE_MAPS_API_KEY not configured; returning mock discovery results",
    );
    return { places: buildMockPlaces(input), source: "mock" };
  }

  const body = {
    includedTypes: input.includedTypes,
    maxResultCount: input.maxResults ?? 20,
    locationRestriction: {
      circle: {
        center: { latitude: input.lat, longitude: input.lng },
        radius: input.radiusMeters,
      },
    },
  };

  // Field mask. Each `places.<field>` costs at the highest billing tier the
  // field touches; we stick to the cheap-tier core fields plus "contact"
  // fields. See https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.internationalPhoneNumber",
    "places.websiteUri",
    "places.rating",
    "places.userRatingCount",
    "places.types",
    "places.location",
  ].join(",");

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      logger.warn(
        { status: response.status, body: text.slice(0, 500) },
        "Google Places API returned non-OK",
      );
      throw new Error(`Places API error ${response.status}`);
    }
    const data = (await response.json()) as {
      places?: Array<{
        id: string;
        displayName?: { text: string };
        formattedAddress?: string;
        internationalPhoneNumber?: string;
        websiteUri?: string;
        rating?: number;
        userRatingCount?: number;
        types?: string[];
        location?: { latitude: number; longitude: number };
      }>;
    };

    const places: DiscoveredPlace[] = (data.places ?? []).map((p) => ({
      googlePlaceId: p.id,
      name: p.displayName?.text ?? "(unnamed place)",
      formattedAddress: p.formattedAddress ?? null,
      phoneE164: normalizeE164(p.internationalPhoneNumber ?? null),
      websiteUri: p.websiteUri ?? null,
      rating: p.rating ?? null,
      userRatingCount: p.userRatingCount ?? null,
      types: p.types ?? [],
      location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null,
    }));
    return { places, source: "google_places" };
  } catch (err) {
    logger.error({ err }, "Google Places API call failed");
    throw err;
  }
}

/**
 * The Places API returns "international" phone numbers like "+1 416-555-0100"
 * (with spaces and dashes). Strip non-digits except the leading + so it
 * matches our E.164 column constraint.
 */
function normalizeE164(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, "");
  return /^\+[1-9]\d{9,14}$/.test(cleaned) ? cleaned : null;
}

/**
 * Mock dataset for dev. Returns a small but realistic-looking set of
 * neighborhood venues. Deterministic based on input.lat so different cities
 * get different mock data.
 */
function buildMockPlaces(input: PlaceSearchInput): DiscoveredPlace[] {
  const baseTypes =
    input.includedTypes.length > 0 ? input.includedTypes : ["bar", "restaurant", "night_club"];

  const seed = Math.floor(Math.abs(input.lat) * 1000) % 100;

  // 8 mock venues, deterministically generated near the input lat/lng.
  return Array.from({ length: 8 }, (_, i) => {
    const offset = (i + 1) / 1000; // ~100m offsets
    return {
      googlePlaceId: `MOCK_${seed}_${i}_${Math.floor(input.lat * 10)}`,
      name: MOCK_NAMES[i] ?? `Mock Venue ${i + 1}`,
      formattedAddress: `${100 + i * 50} Mock St`,
      phoneE164: i % 3 === 0 ? `+1416555${String(1000 + i).padStart(4, "0")}` : null,
      websiteUri: i % 2 === 0 ? `https://mock-venue-${i}.example` : null,
      rating: 3.5 + (i % 4) * 0.3,
      userRatingCount: 50 + i * 23,
      types: [baseTypes[i % baseTypes.length] ?? "bar", "point_of_interest"],
      location: {
        lat: input.lat + offset,
        lng: input.lng + offset,
      },
    };
  });
}

const MOCK_NAMES = [
  "The Phantom Pub",
  "Velvet Lounge",
  "The Drake Tavern",
  "Caffeine Cathedral",
  "Bar Volo",
  "The Midnight Vault",
  "Crown & Anchor",
  "Speakeasy 42",
];

// =========================================================================
// Maps URL → place_id resolver (added to support the "Paste Maps link"
// venue autocomplete flow). Reuses GOOGLE_MAPS_API_KEY.
// =========================================================================

export interface PlaceDetails {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  lat: number | null;
  lng: number | null;
  googleMapsUri: string | null;
  rating: number | null;
  userRatingCount: number | null;
  /** Place types: bar, night_club, restaurant, etc. */
  types: string[];
}

export function isGoogleMapsConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

/**
 * Parse a Google Maps URL and extract enough to resolve a place.
 *
 * URL formats we handle:
 *   - https://www.google.com/maps/place/{Name}/@{lat},{lng}/data=...!1s{placeId}
 *   - https://maps.app.goo.gl/{shortcode}  (Maps share link)
 *   - https://goo.gl/maps/{shortcode}      (legacy share link)
 *   - https://www.google.com/maps/search/?api=1&query=...&query_place_id={id}
 *
 * Returns either { placeId } or { lat, lng } or { shortUrl } for the
 * caller to follow up with resolveShortMapsUrl.
 */
/**
 * parseGoogleMapsUrl — accept any of Google's many share-link shapes,
 * return a tagged union the caller can use to look up the venue.
 *
 * Shapes handled (in priority order):
 *
 *   1. ChIJ place_id embedded in path/data:
 *      `/maps/place/Foo/.../data=!4m6!1sChIJxxxxx`
 *      → { placeId }
 *
 *   2. place_id as query param:
 *      `/maps/search/?api=1&query=Foo&query_place_id=ChIJxxxxx`
 *      → { placeId }
 *
 *   3. CID (Customer ID — legacy Google Maps internal venue id):
 *      `/maps?cid=9000584681264449884`
 *      `/?cid=9000584681264449884`
 *      → { cid, lat?, lng? }
 *      The new Places API doesn't accept CIDs. resolveMapsUrlToPlace
 *      bridges via the legacy place-details endpoint to convert
 *      cid → place_id.
 *
 *   4. /maps/search/<query>/...  (a SEARCH, not a single venue):
 *      → { searchQuery }
 *      Operator should redo the share on the specific venue tile.
 *
 *   5. Coord-only (no venue):
 *      `/maps/@43.65,-79.38,15z` or `?ll=43.65,-79.38`
 *      → { lat, lng }
 *      Operator needs to tap the specific venue first.
 *
 *   6. Short links (maps.app.goo.gl / goo.gl):
 *      → { shortUrl }   — caller follows the redirect via
 *                         resolveShortMapsUrl()
 *
 * Returns null if the URL doesn't parse or doesn't look like Google.
 */
export function parseGoogleMapsUrl(
  rawUrl: string,
):
  | { placeId: string }
  | { cid: string; lat?: number; lng?: number }
  | { searchQuery: string; lat?: number; lng?: number }
  | { lat: number; lng: number }
  | { shortUrl: string }
  | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!host.includes("google") && !host.includes("goo.gl")) {
    return null;
  }

  // 6. short links — caller resolves via HEAD redirect
  if (host === "maps.app.goo.gl" || host === "goo.gl") {
    return { shortUrl: rawUrl.trim() };
  }

  // 2. explicit query_place_id
  const placeIdQuery = url.searchParams.get("query_place_id");
  if (placeIdQuery) return { placeId: placeIdQuery };

  // 1. place_id embedded in path !1s prefix or place_id: literal
  const dataParam = url.pathname + url.search;
  const placeIdMatch =
    dataParam.match(/!1s(ChIJ[A-Za-z0-9_\-]+)/) ?? dataParam.match(/place_id:([A-Za-z0-9_\-]+)/);
  if (placeIdMatch?.[1]) return { placeId: placeIdMatch[1] };

  // Helper: extract `ll=lat,lng` from the query string (cid URLs have this)
  function llFromQuery(): { lat: number; lng: number } | null {
    const ll = url.searchParams.get("ll");
    if (!ll) return null;
    const [latStr, lngStr] = ll.split(",");
    if (!latStr || !lngStr) return null;
    const lat = Number.parseFloat(latStr);
    const lng = Number.parseFloat(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  // 3. CID (Customer ID). Decimal digits, often very long (up to 20).
  const cid = url.searchParams.get("cid");
  if (cid && /^\d+$/.test(cid)) {
    const ll = llFromQuery();
    return ll ? { cid, lat: ll.lat, lng: ll.lng } : { cid };
  }

  // 4. /maps/search/<query>/... — a search, not a venue
  const searchMatch = url.pathname.match(/\/maps\/search\/([^/]+)/);
  if (searchMatch?.[1]) {
    const raw = searchMatch[1];
    // The path segment may use '+' for spaces (URL-encoded)
    const query = decodeURIComponent(raw.replace(/\+/g, " "));
    const coordMatch = url.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (coordMatch?.[1] && coordMatch[2]) {
      return {
        searchQuery: query,
        lat: Number.parseFloat(coordMatch[1]),
        lng: Number.parseFloat(coordMatch[2]),
      };
    }
    return { searchQuery: query };
  }

  // 5. coord-only — either in path (@lat,lng) or query (?ll=lat,lng)
  const coordMatch = url.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (coordMatch?.[1] && coordMatch[2]) {
    return { lat: Number.parseFloat(coordMatch[1]), lng: Number.parseFloat(coordMatch[2]) };
  }
  const ll = llFromQuery();
  if (ll) return ll;
  return null;
}

export async function resolveShortMapsUrl(
  shortUrl: string,
): Promise<Exclude<ReturnType<typeof parseGoogleMapsUrl>, { shortUrl: string } | null> | null> {
  try {
    const response = await fetch(shortUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    const location = response.headers.get("location");
    if (!location) return null;
    const parsed = parseGoogleMapsUrl(location);
    if (!parsed) return null;
    // Recursive shortUrl shouldn't happen (Google doesn't chain short
    // links), but guard anyway
    if ("shortUrl" in parsed) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const apiKey = env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,location,googleMapsUri,rating,userRatingCount,types",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) {
      logger.warn({ status: response.status, placeId }, "places details non-200");
      return null;
    }
    const json = (await response.json()) as Record<string, unknown>;
    return mapPlaceDetailsJson(json);
  } catch (err) {
    logger.warn({ err, placeId }, "places details fetch failed");
    return null;
  }
}

function mapPlaceDetailsJson(json: Record<string, unknown>): PlaceDetails | null {
  const id = json.id as string | undefined;
  if (!id) return null;
  const displayName = json.displayName as { text?: string } | undefined;
  const location = json.location as { latitude?: number; longitude?: number } | undefined;
  const types = (json.types as string[] | undefined) ?? [];
  return {
    placeId: id,
    name: displayName?.text ?? "(no name)",
    address: (json.formattedAddress as string | null) ?? null,
    phone:
      (json.internationalPhoneNumber as string | null) ??
      (json.nationalPhoneNumber as string | null) ??
      null,
    website: (json.websiteUri as string | null) ?? null,
    lat: location?.latitude ?? null,
    lng: location?.longitude ?? null,
    googleMapsUri: (json.googleMapsUri as string | null) ?? null,
    rating: (json.rating as number | null) ?? null,
    userRatingCount: (json.userRatingCount as number | null) ?? null,
    types,
  };
}

/**
 * Result of resolving a pasted Maps URL.
 *
 * - `venue`: we got a specific business with full details. Use as-is.
 * - `search_url`: the URL is a Maps SEARCH page, not a venue. The
 *   caller should tell the operator to use the city-map's
 *   pan-and-search feature instead, or re-share from the specific
 *   venue tile.
 * - `coord_only`: the URL only has lat/lng (no place_id, no CID).
 *   Operator should tap the specific venue on the Maps app first
 *   and re-share.
 * - `cid_unresolved`: we recognized a CID but couldn't convert it to
 *   a place_id (network issue or Google didn't redirect cleanly).
 *   Caller can fall back to a Nearby Search if lat/lng was included.
 * - `not_a_maps_url`: doesn't look like a Google Maps URL at all.
 * - `lookup_failed`: had a place_id but Place Details API call failed.
 */
export type ResolveMapsUrlResult =
  | { kind: "venue"; place: PlaceDetails }
  | { kind: "search_url"; query: string; lat?: number; lng?: number }
  | { kind: "coord_only"; lat: number; lng: number }
  | { kind: "cid_unresolved"; cid: string; lat?: number; lng?: number }
  | { kind: "not_a_maps_url" }
  | { kind: "lookup_failed" };

/**
 * Resolve a CID (Customer ID — legacy Google Maps internal venue id)
 * to a modern place_id (ChIJ…). The new Places API doesn't accept CIDs
 * directly, so we follow https://www.google.com/maps?cid=<cid> and try
 * two strategies:
 *
 *   1. The Location header / final URL of the redirect chain usually
 *      contains /maps/place/.../data=!1sChIJ…  → parse that.
 *   2. Failing that, scan the HTML body for the first `ChIJ…` token.
 *      Google embeds the place_id in the page even when no redirect
 *      delivers it via URL.
 *
 * Returns null if both strategies fail (e.g. network timeout, or
 * Google's CID format changed). Caller can fall back to a Nearby
 * Search at the lat/lng that was alongside the CID in the URL.
 */
async function resolveCidToPlaceId(cid: string): Promise<string | null> {
  try {
    const response = await fetch(`https://www.google.com/maps?cid=${encodeURIComponent(cid)}`, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });

    // Strategy 1 — final URL after redirects often holds the place_id
    const finalUrl = response.url;
    const fromUrl = parseGoogleMapsUrl(finalUrl);
    if (fromUrl && "placeId" in fromUrl) return fromUrl.placeId;

    // Strategy 2 — HTML body scan
    const text = await response.text();
    // ChIJ-prefixed place_ids are typically 27 chars. Match conservatively
    // to avoid false positives.
    const match = text.match(/(ChIJ[A-Za-z0-9_-]{20,30})/);
    if (match?.[1]) return match[1];

    return null;
  } catch {
    return null;
  }
}

/**
 * Convenience: paste a Maps URL → place details in one call.
 *
 * Returns a discriminated union so the caller can show a specific
 * error message per URL shape (search vs coord-only vs CID failure)
 * instead of a generic "couldn't resolve" string.
 */
export async function resolveMapsUrlToPlace(rawUrl: string): Promise<ResolveMapsUrlResult> {
  let parsed = parseGoogleMapsUrl(rawUrl);
  if (!parsed) return { kind: "not_a_maps_url" };

  if ("shortUrl" in parsed) {
    const resolved = await resolveShortMapsUrl(parsed.shortUrl);
    if (!resolved) return { kind: "lookup_failed" };
    parsed = resolved;
  }

  if ("searchQuery" in parsed) {
    return {
      kind: "search_url",
      query: parsed.searchQuery,
      lat: parsed.lat,
      lng: parsed.lng,
    };
  }

  if ("cid" in parsed) {
    const placeId = await resolveCidToPlaceId(parsed.cid);
    if (!placeId) {
      return { kind: "cid_unresolved", cid: parsed.cid, lat: parsed.lat, lng: parsed.lng };
    }
    const place = await fetchPlaceDetails(placeId);
    return place ? { kind: "venue", place } : { kind: "lookup_failed" };
  }

  if ("placeId" in parsed) {
    const place = await fetchPlaceDetails(parsed.placeId);
    return place ? { kind: "venue", place } : { kind: "lookup_failed" };
  }

  // Coord-only — last branch
  return { kind: "coord_only", lat: parsed.lat, lng: parsed.lng };
}

/**
 * Nearby search around (lat,lng) for venues we'd target on a crawl.
 * Types: bar | night_club | restaurant.
 *
 * Returns up to `maxResults` candidate places. Caller dedupes against
 * existing venues by place_id BEFORE persisting to keep Details calls
 * cheap (Nearby returns most of what we need already).
 */
export async function nearbyVenueSearch(opts: {
  lat: number;
  lng: number;
  radiusM?: number;
  maxResults?: number;
}): Promise<PlaceDetails[]> {
  const apiKey = env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.location,places.googleMapsUri,places.rating,places.userRatingCount,places.types",
      },
      body: JSON.stringify({
        includedTypes: ["bar", "night_club", "restaurant"],
        maxResultCount: Math.min(opts.maxResults ?? 20, 20),
        locationRestriction: {
          circle: {
            center: { latitude: opts.lat, longitude: opts.lng },
            radius: opts.radiusM ?? 1500,
          },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "places nearby non-200");
      return [];
    }
    const json = (await response.json()) as { places?: Array<Record<string, unknown>> };
    return (json.places ?? []).map(mapPlaceDetailsJson).filter((p): p is PlaceDetails => !!p);
  } catch (err) {
    logger.warn({ err }, "places nearby fetch failed");
    return [];
  }
}

// =========================================================================
// Text Search — used by the city map's auto-center logic. Asks Google
// "where are the bars in {city}?" and lets us drop the initial map pin
// at the geometric center of the top results, NOT at the city's
// recorded centroid (which is usually a town hall or post office).
//
// Returns up to `maxResults` places matching the query. We then average
// their coords to produce a single "best center" point.
// =========================================================================

export interface TextSearchPlace {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  rating: number | null;
  userRatingCount: number | null;
}

export async function textSearchPlaces(opts: {
  query: string;
  /** Anchor the search inside a bounding circle. Optional but recommended
      so "bars Toronto" doesn't pull in matches in Toronto, Ohio. */
  bias?: { lat: number; lng: number; radiusM: number };
  maxResults?: number;
}): Promise<TextSearchPlace[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return [];

  try {
    const body: Record<string, unknown> = {
      textQuery: opts.query,
      maxResultCount: Math.min(opts.maxResults ?? 10, 20),
    };
    if (opts.bias) {
      body.locationBias = {
        circle: {
          center: { latitude: opts.bias.lat, longitude: opts.bias.lng },
          radius: opts.bias.radiusM,
        },
      };
    }

    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.location,places.rating,places.userRatingCount",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, "places text search non-200");
      return [];
    }

    const json = (await response.json()) as {
      places?: Array<{
        id: string;
        displayName?: { text?: string };
        location?: { latitude?: number; longitude?: number };
        rating?: number;
        userRatingCount?: number;
      }>;
    };

    return (json.places ?? [])
      .filter((p) => p.location?.latitude != null && p.location?.longitude != null)
      .map((p) => ({
        placeId: p.id,
        name: p.displayName?.text ?? "(no name)",
        lat: p.location?.latitude as number,
        lng: p.location?.longitude as number,
        rating: p.rating ?? null,
        userRatingCount: p.userRatingCount ?? null,
      }));
  } catch (err) {
    logger.warn({ err }, "places text search fetch failed");
    return [];
  }
}

/**
 * Compute the geometric center of a set of points. Used to pick the
 * starting pan target for the city map. Weighted by userRatingCount
 * (popular places anchor harder) so a single tiny review-less bar in
 * the suburbs doesn't pull the map toward it.
 */
export function weightedCenter(
  places: Array<{ lat: number; lng: number; userRatingCount: number | null }>,
): { lat: number; lng: number } | null {
  if (places.length === 0) return null;
  let sumLat = 0;
  let sumLng = 0;
  let sumW = 0;
  for (const p of places) {
    // log-weight to soften extremes — a 10,000-review bar shouldn't be
    // 100x the weight of a 100-review one
    const w = Math.log1p(Math.max(0, p.userRatingCount ?? 1));
    sumLat += p.lat * w;
    sumLng += p.lng * w;
    sumW += w;
  }
  if (sumW === 0) return null;
  return { lat: sumLat / sumW, lng: sumLng / sumW };
}
