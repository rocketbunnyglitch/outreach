/**
 * Backfill venues.location (+ google_place_id when free) for CONFIRMED
 * lineup venues that have an address but no coordinates — the public
 * lineup API was serving lat/lng null for every confirmed venue, which
 * leaves the Smart Map with nothing to plot.
 *
 * Conservative by design:
 *   - only venues on a confirmed venue_event of an unarchived event
 *   - only fills NULL location (never overwrites operator data)
 *   - top Places text-search hit must share a significant name token
 *     with the venue, otherwise the venue is skipped and logged
 *
 * Run: npx tsx --env-file=<release .env> scripts/backfill-confirmed-venue-coords.ts
 */
import { db } from "@/lib/db";
import { textSearchPlaces } from "@/lib/google-places";
import { sql } from "drizzle-orm";

function rows<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

function significantTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 3 && !["the", "and", "bar", "club", "restaurant"].includes(t)),
  );
}

async function main() {
  const targets = rows<{ id: string; name: string; address: string; city: string }>(
    await db.execute(sql`
      SELECT DISTINCT v.id, v.name, v.address, c.name AS city
      FROM venue_events ve
      JOIN events e ON e.id = ve.event_id AND e.archived_at IS NULL
      JOIN venues v ON v.id = ve.venue_id
      JOIN cities c ON c.id = v.city_id
      WHERE ve.status = 'confirmed' AND v.location IS NULL AND v.address IS NOT NULL
    `),
  );
  console.info(`[coords] ${targets.length} confirmed venues missing coordinates`);

  let filled = 0;
  let skipped = 0;
  for (const t of targets) {
    const hits = await textSearchPlaces({ query: `${t.name}, ${t.address}`, maxResults: 3 });
    const top = hits[0];
    if (!top) {
      console.info(`[coords] SKIP no result: ${t.name} (${t.city})`);
      skipped += 1;
      continue;
    }
    const want = significantTokens(t.name);
    const got = significantTokens(top.name);
    const overlap = [...want].some((tok) => got.has(tok));
    if (want.size > 0 && !overlap) {
      console.info(`[coords] SKIP name mismatch: "${t.name}" vs Places "${top.name}" (${t.city})`);
      skipped += 1;
      continue;
    }
    await db.execute(sql`
      UPDATE venues SET
        location = ST_SetSRID(ST_MakePoint(${top.lng}, ${top.lat}), 4326)::geography,
        google_place_id = CASE
          WHEN google_place_id IS NULL AND NOT EXISTS (
            SELECT 1 FROM venues v2 WHERE v2.google_place_id = ${top.placeId} AND v2.id <> ${t.id}::uuid)
          THEN ${top.placeId}
          ELSE google_place_id
        END,
        updated_at = now()
      WHERE id = ${t.id}::uuid AND location IS NULL
    `);
    console.info(
      `[coords] OK ${t.name} (${t.city}) -> ${top.lat.toFixed(5)},${top.lng.toFixed(5)}`,
    );
    filled += 1;
  }
  console.info(`[coords] done: ${filled} filled, ${skipped} skipped of ${targets.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[coords] crashed:", err);
  process.exit(1);
});
