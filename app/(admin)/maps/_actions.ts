"use server";

/**
 * Server actions for the standalone /maps tab.
 *
 * This is the Google-Maps-like surface — search anywhere, click a pin,
 * add it to the venue directory. NOT scoped to a city campaign (that's
 * what CityVenueMap is for).
 */

import { venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { fetchPlaceDetails, isGoogleMapsConfigured, textSearchPlaces } from "@/lib/google-places";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export interface MapsSearchResult {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  rating: number | null;
  userRatingCount: number | null;
}

/**
 * Free-text place search, optionally biased to the current map center so
 * "bars" actually returns bars in what you're looking at and not on the
 * other side of the world. Returns up to 20 results.
 */
export async function mapsSearchPlaces(input: {
  query: string;
  bias?: { lat: number; lng: number; radiusM: number };
}): Promise<{ ok: boolean; results?: MapsSearchResult[]; error?: string }> {
  await requireStaff();
  if (!isGoogleMapsConfigured()) {
    return { ok: false, error: "Google Maps API not configured." };
  }
  const q = (input.query ?? "").trim();
  if (!q) return { ok: true, results: [] };
  try {
    const places = await textSearchPlaces({
      query: q,
      bias: input.bias,
      maxResults: 20,
    });
    return { ok: true, results: places };
  } catch (err) {
    console.error("[maps] textSearchPlaces failed", err);
    return { ok: false, error: "Search failed." };
  }
}

/**
 * Fetch the rich detail payload for a single place (called when the
 * operator clicks a pin / result so the InfoWindow can show address,
 * phone, website, etc. without bloating the initial search).
 */
export async function mapsLoadPlaceDetails(placeId: string): Promise<{
  ok: boolean;
  details?: {
    placeId: string;
    name: string;
    address: string | null;
    phone: string | null;
    website: string | null;
    lat: number | null;
    lng: number | null;
    rating: number | null;
    userRatingCount: number | null;
    types: string[];
    /** True if a venue with this google_place_id is already in the directory. */
    existsAsVenue: boolean;
    /** The venue id if it already exists, else null. */
    venueId: string | null;
  };
  error?: string;
}> {
  await requireStaff();
  if (!isGoogleMapsConfigured()) {
    return { ok: false, error: "Google Maps API not configured." };
  }
  try {
    const details = await fetchPlaceDetails(placeId);
    if (!details) return { ok: false, error: "Place not found." };
    const existing = await db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.googlePlaceId, placeId))
      .limit(1);
    return {
      ok: true,
      details: {
        ...details,
        existsAsVenue: existing.length > 0,
        venueId: existing[0]?.id ?? null,
      },
    };
  } catch (err) {
    console.error("[maps] fetchPlaceDetails failed", { err, placeId });
    return { ok: false, error: "Couldn't load place details." };
  }
}

/**
 * Add a discovered place to the venue directory under a chosen city.
 * Idempotent on google_place_id: if a venue already exists for the place,
 * just returns its id. Mirrors addPlaceToCampaign minus the campaign
 * attach — operators on this surface aren't picking a campaign, they're
 * just building the directory.
 */
export async function mapsAddPlaceAsVenue(input: {
  placeId: string;
  cityId: string;
}): Promise<{
  ok: boolean;
  venueId?: string;
  alreadyExisted?: boolean;
  error?: string;
}> {
  const { staff } = await requireStaff();

  // Dedup first — never create twice for the same google_place_id.
  const existing = await db
    .select({ id: venues.id })
    .from(venues)
    .where(eq(venues.googlePlaceId, input.placeId))
    .limit(1);
  if (existing[0]) {
    return { ok: true, venueId: existing[0].id, alreadyExisted: true };
  }

  if (!isGoogleMapsConfigured()) {
    return { ok: false, error: "Google Maps API not configured." };
  }
  const details = await fetchPlaceDetails(input.placeId);
  if (!details) return { ok: false, error: "Couldn't load place details." };

  try {
    const [created] = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(venues)
        .values({
          cityId: input.cityId,
          name: details.name,
          googlePlaceId: input.placeId,
          address: details.address,
          phoneE164: details.phone,
          websiteUrl: details.website,
          location:
            details.lat != null && details.lng != null
              ? { lng: details.lng, lat: details.lat }
              : null,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: venues.id }),
    );
    if (!created) return { ok: false, error: "Insert returned no row." };

    try {
      revalidatePath("/venues");
    } catch {
      // non-fatal
    }
    return { ok: true, venueId: created.id, alreadyExisted: false };
  } catch (err) {
    console.error("[maps] venue insert failed", { err, placeId: input.placeId });
    return { ok: false, error: "Couldn't create the venue." };
  }
}

/** Cities list for the InfoWindow's city picker. Includes coords so
 *  the client can auto-select the closest city to a place. */
export async function mapsLoadCities(): Promise<
  Array<{ id: string; name: string; region: string | null; lat: number | null; lng: number | null }>
> {
  await requireStaff();
  // Pull cities + extract their lat/lng from the PostGIS geography
  // column via ST_X / ST_Y on the casted geometry. NULL location rows
  // come back with null lat+lng and the client falls back to the first
  // city in the dropdown.
  const { sql } = await import("drizzle-orm");
  const rows = await db.execute<{
    id: string;
    name: string;
    region: string | null;
    lat: number | null;
    lng: number | null;
  }>(sql`
    SELECT id::text AS id,
           name,
           region,
           CASE WHEN location IS NULL THEN NULL
                ELSE ST_Y(location::geometry) END AS lat,
           CASE WHEN location IS NULL THEN NULL
                ELSE ST_X(location::geometry) END AS lng
      FROM cities
     WHERE archived_at IS NULL
  ORDER BY name
  `);
  type Row = {
    id: string;
    name: string;
    region: string | null;
    lat: number | null;
    lng: number | null;
  };
  const list: Row[] = Array.isArray(rows)
    ? (rows as unknown as Row[])
    : ((rows as unknown as { rows: Row[] }).rows ?? []);
  return list.map((r) => ({
    id: r.id,
    name: r.name,
    region: r.region,
    lat: r.lat != null ? Number(r.lat) : null,
    lng: r.lng != null ? Number(r.lng) : null,
  }));
}
