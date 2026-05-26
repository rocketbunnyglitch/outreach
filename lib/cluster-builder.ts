/**
 * Cluster builder query helpers.
 *
 * Pulls venues with coordinates from a city + computes cluster groupings.
 * Separated from `clustering.ts` (pure functions) so the DB layer stays
 * out of the algorithm.
 */

import { venues } from "@/db/schema";
import { type VenueForClustering, clusterVenuesByWalkingDistance } from "@/lib/clustering";
import { db } from "@/lib/db";
import { and, eq, isNull, sql } from "drizzle-orm";

/**
 * Fetch every active venue in a city that has location data (lat/lng).
 * Venues without coordinates are silently excluded — they can't cluster.
 *
 * Uses ST_X / ST_Y on the PostGIS geography column to extract numeric
 * coords for the algorithm.
 */
export async function fetchClusterableVenues(cityId: string): Promise<VenueForClustering[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    address: string | null;
    lat: number;
    lng: number;
  }>(sql`
    SELECT
      id,
      name,
      address,
      ST_Y(location::geometry) AS lat,
      ST_X(location::geometry) AS lng
    FROM venues
    WHERE city_id = ${cityId}
      AND archived_at IS NULL
      AND location IS NOT NULL
      AND do_not_contact = false
    ORDER BY name ASC
  `);

  // db.execute returns either an array or { rows: [...] } depending on driver.
  // Normalize without using  (biome rule).
  type Row = { id: string; name: string; address: string | null; lat: number; lng: number };
  const list: Row[] = Array.isArray(rows)
    ? (rows as unknown as Row[])
    : ((rows as unknown as { rows: Row[] }).rows ?? []);

  return list.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    latitude: Number(r.lat),
    longitude: Number(r.lng),
  }));
}

/**
 * Count of venues in a city that DON'T have coordinates yet.
 * Surfaced as a warning in the cluster builder UI ("12 venues skipped
 * because they don't have lat/lng yet — run discover or set them
 * manually").
 */
export async function countVenuesWithoutCoordinates(cityId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(venues)
    .where(and(eq(venues.cityId, cityId), isNull(venues.archivedAt), isNull(venues.location)));
  return Number(result[0]?.count ?? 0);
}

/**
 * One-shot helper for the cluster builder page: fetch + cluster + return.
 * Defaults to 400m walking radius. Page-level options can override.
 */
export async function buildClustersForCity(cityId: string, radiusMeters = 400) {
  const venues = await fetchClusterableVenues(cityId);
  const clusters = clusterVenuesByWalkingDistance(venues, radiusMeters);
  const missingCoords = await countVenuesWithoutCoordinates(cityId);
  return { venues, clusters, missingCoords };
}
