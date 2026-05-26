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
export function parseGoogleMapsUrl(
  rawUrl: string,
): { placeId: string } | { lat: number; lng: number } | { shortUrl: string } | null {
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

  if (host === "maps.app.goo.gl" || host === "goo.gl") {
    return { shortUrl: rawUrl.trim() };
  }

  const placeIdQuery = url.searchParams.get("query_place_id");
  if (placeIdQuery) return { placeId: placeIdQuery };

  const dataParam = url.pathname + url.search;
  const placeIdMatch =
    dataParam.match(/!1s(ChIJ[A-Za-z0-9_\-]+)/) ?? dataParam.match(/place_id:([A-Za-z0-9_\-]+)/);
  if (placeIdMatch?.[1]) return { placeId: placeIdMatch[1] };

  const coordMatch = url.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (coordMatch?.[1] && coordMatch[2]) {
    return { lat: Number.parseFloat(coordMatch[1]), lng: Number.parseFloat(coordMatch[2]) };
  }
  return null;
}

export async function resolveShortMapsUrl(
  shortUrl: string,
): Promise<{ placeId: string } | { lat: number; lng: number } | null> {
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
 * Convenience: paste a Maps URL → place details in one call.
 *
 * Returns null when:
 *   - URL doesn't parse
 *   - Short URL can't be resolved
 *   - GOOGLE_MAPS_API_KEY isn't configured
 *   - Places Details lookup fails
 *
 * Caller (typically a server action) translates null into a graceful
 * "couldn't autopopulate, please fill manually" message.
 */
export async function resolveMapsUrlToPlace(rawUrl: string): Promise<PlaceDetails | null> {
  let parsed = parseGoogleMapsUrl(rawUrl);
  if (!parsed) return null;
  if ("shortUrl" in parsed) {
    const resolved = await resolveShortMapsUrl(parsed.shortUrl);
    if (!resolved) return null;
    parsed = resolved;
  }
  if ("placeId" in parsed) {
    return fetchPlaceDetails(parsed.placeId);
  }
  // Coord-only URLs lack a place_id; we can't cheaply resolve to a
  // specific business. Operator should re-share from the Maps app
  // after clicking the venue (which produces a place_id URL).
  return null;
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
