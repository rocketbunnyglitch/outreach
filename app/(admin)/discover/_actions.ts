"use server";

/**
 * Lead-generation server actions.
 *
 *  - `searchPlaces` is called when the operator submits the search form on
 *    /discover. Hits Google Places (or mock) for the chosen city + filters,
 *    returns the list. No DB writes.
 *
 *  - `importDiscoveredPlaces` is called when the operator clicks "Import
 *    selected". Inserts venues, deduplicating against existing
 *    `googlePlaceId` values. All inserts in one withAuditContext transaction
 *    so audit_log captures the batch with proper attribution.
 */

import { cities, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import {
  type DiscoveredPlace,
  type PlaceSearchResult,
  searchNearbyPlaces,
} from "@/lib/google-places";
import { logger } from "@/lib/logger";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { DatabaseError } from "pg";

interface SearchResult {
  ok: boolean;
  result?: PlaceSearchResult;
  cityId?: string;
  existingPlaceIds?: string[];
  error?: string;
}

const ALLOWED_TYPES = new Set([
  "bar",
  "night_club",
  "restaurant",
  "cafe",
  "pub",
  "wine_bar",
  "cocktail_lounge",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Search nearby places for a city. The form sends:
 *   - cityId         (uuid)
 *   - types          (one checkbox value per included type)
 *   - radiusMeters   (number; defaults to 2000)
 */
export async function searchPlaces(_prev: unknown, formData: FormData): Promise<SearchResult> {
  await requireStaff();

  const cityId = String(formData.get("cityId") ?? "");
  if (!UUID_RE.test(cityId)) {
    return { ok: false, error: "Invalid city selection." };
  }
  const rawTypes = formData.getAll("types").map(String);
  const includedTypes = rawTypes.filter((t) => ALLOWED_TYPES.has(t));
  if (includedTypes.length === 0) {
    return { ok: false, error: "Pick at least one place type." };
  }
  const radiusMeters = Math.min(
    Math.max(Number.parseInt(String(formData.get("radiusMeters") ?? "2000"), 10), 100),
    50000,
  );

  // Resolve the city's lat/lng. Required: cities.location must be set.
  const [city] = await db
    .select({
      id: cities.id,
      name: cities.name,
      location: cities.location,
    })
    .from(cities)
    .where(eq(cities.id, cityId))
    .limit(1);
  if (!city) {
    return { ok: false, error: "City not found." };
  }
  if (!city.location) {
    return {
      ok: false,
      error: `${city.name} has no coordinates set. Edit the city and add lat/lng before searching.`,
    };
  }

  try {
    const result = await searchNearbyPlaces({
      lat: city.location.lat,
      lng: city.location.lng,
      radiusMeters,
      includedTypes,
    });

    // Check which place_ids already exist in venues so the UI can mark them
    // as "already imported".
    const allPlaceIds = result.places.map((p) => p.googlePlaceId).filter(Boolean);
    const existingRows =
      allPlaceIds.length > 0
        ? await db
            .select({ googlePlaceId: venues.googlePlaceId })
            .from(venues)
            .where(inArray(venues.googlePlaceId, allPlaceIds))
        : [];
    const existingPlaceIds = existingRows
      .map((r) => r.googlePlaceId)
      .filter((id): id is string => id !== null);

    return { ok: true, result, cityId: city.id, existingPlaceIds };
  } catch (err) {
    logger.error({ err }, "places search failed");
    // Per CLAUDE.md §12.4 — no silent failures. The operator must be
    // able to see which API failed and how, so they know whether the
    // fix is in Cloud Console (key restriction), .env
    // (GOOGLE_MAPS_API_KEY missing), or something else.
    const detail = parseGoogleMapsError(err);
    return {
      ok: false,
      error: `Places search failed. ${detail}`,
    };
  }
}

/**
 * Surface enough info about a Places API error that the operator can
 * fix it. Specifically distinguishes:
 *   - missing key (env var unset)
 *   - key rejected (403 — usually referrer restriction or API not
 *     enabled in Cloud Console)
 *   - rate / quota (429)
 *   - network (ECONN*)
 *   - other (return the raw message)
 *
 * Never leak stack traces; safe to display in the UI.
 */
function parseGoogleMapsError(err: unknown): string {
  const e = err as { status?: number; message?: string; code?: string };
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return "GOOGLE_MAPS_API_KEY is not set on the server. Add it to /var/www/outreach/.env and restart.";
  }
  if (typeof e?.status === "number") {
    if (e.status === 403) {
      return "Google rejected the Maps API key (403). Most common causes: the HTTP referrer restriction in Cloud Console doesn't include outreach.barcrawlconnect.com, OR Places API (New) isn't enabled for this key. https://console.cloud.google.com/apis/credentials";
    }
    if (e.status === 429) {
      return "Google Maps quota/rate-limit hit (429). Wait or check billing.";
    }
    if (e.status === 401) {
      return "Google rejected the key (401). Verify the key string in /var/www/outreach/.env matches the active key in Cloud Console.";
    }
    if (e.status >= 500) {
      return `Google Maps server error (${e.status}). Likely transient — try again.`;
    }
  }
  if (e?.message && /(ECONNREFUSED|ENOTFOUND|fetch failed|ETIMEDOUT)/i.test(e.message)) {
    return `Network error reaching Google: ${e.message}`;
  }
  if (e?.message) return e.message.slice(0, 200);
  return "Unknown error — check the server logs for the stack trace.";
}

interface ImportResult {
  ok: boolean;
  inserted?: number;
  skipped?: number;
  error?: string;
}

/**
 * Bulk-insert selected discovered places as venues.
 *
 * The form submits:
 *   - cityId          (uuid)
 *   - places          (one hidden JSON-encoded payload per selected place,
 *                      with field name "place")
 *
 * We re-validate the city + payload server-side; we never trust the
 * round-tripped JSON to be safe. Dedup on `googlePlaceId` so re-running a
 * search and re-importing is idempotent.
 */
export async function importDiscoveredPlaces(
  _prev: unknown,
  formData: FormData,
): Promise<ImportResult> {
  const { staff } = await requireStaff();

  const cityId = String(formData.get("cityId") ?? "");
  if (!UUID_RE.test(cityId)) {
    return { ok: false, error: "Invalid city selection." };
  }
  const placePayloads = formData.getAll("place").map(String);
  if (placePayloads.length === 0) {
    return { ok: false, error: "No places selected." };
  }
  if (placePayloads.length > 100) {
    return {
      ok: false,
      error: "Limit 100 venues per import batch.",
    };
  }

  // Parse each payload. Skip silently on parse errors — should not happen
  // from our form but defense in depth.
  const parsed: DiscoveredPlace[] = [];
  for (const raw of placePayloads) {
    try {
      const obj = JSON.parse(raw);
      if (
        typeof obj === "object" &&
        obj !== null &&
        typeof obj.googlePlaceId === "string" &&
        typeof obj.name === "string"
      ) {
        parsed.push(obj as DiscoveredPlace);
      }
    } catch {
      // Ignore malformed entries
    }
  }
  if (parsed.length === 0) {
    return { ok: false, error: "No valid place data in submission." };
  }

  // Pre-fetch existing googlePlaceIds for dedup.
  const placeIds = parsed.map((p) => p.googlePlaceId);
  const existing = await db
    .select({ googlePlaceId: venues.googlePlaceId })
    .from(venues)
    .where(inArray(venues.googlePlaceId, placeIds));
  const existingSet = new Set(existing.map((r) => r.googlePlaceId).filter(Boolean));

  const toInsert = parsed.filter((p) => !existingSet.has(p.googlePlaceId));
  if (toInsert.length === 0) {
    return {
      ok: true,
      inserted: 0,
      skipped: parsed.length,
    };
  }

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx.insert(venues).values(
        toInsert.map((p) => ({
          cityId,
          name: p.name,
          googlePlaceId: p.googlePlaceId,
          address: p.formattedAddress ?? undefined,
          phoneE164: p.phoneE164 ?? undefined,
          websiteUrl: p.websiteUri ?? undefined,
          location: p.location ?? undefined,
          // Conservative defaults — operator can refine on the venue page.
          servesAlcohol: p.types.some((t) =>
            ["bar", "night_club", "pub", "wine_bar", "cocktail_lounge"].includes(t),
          ),
          internalNotes: `Imported from Google Places. Types: ${p.types.join(", ")}${
            p.rating ? ` · rating ${p.rating} (${p.userRatingCount} reviews)` : ""
          }`,
          doNotContact: false,
          createdBy: staff.id,
          updatedBy: staff.id,
        })),
      );
    });
  } catch (err) {
    const dbErr = err as DatabaseError;
    logger.error({ err, code: dbErr?.code }, "places import insert failed");
    return {
      ok: false,
      error: "Bulk insert failed — no venues imported. Check server logs.",
    };
  }

  revalidatePath("/venues");
  revalidatePath("/discover");

  return {
    ok: true,
    inserted: toInsert.length,
    skipped: parsed.length - toInsert.length,
  };
}
