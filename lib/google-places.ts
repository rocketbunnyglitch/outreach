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
