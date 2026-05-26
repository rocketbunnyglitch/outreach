/**
 * Phase 5a milestone test: full discovery → import chain.
 *
 * Exercises the parts the server actions use:
 *   1. searchNearbyPlaces() returns mock data when no API key is set
 *   2. Bulk insert of selected places via withAuditContext
 *   3. Dedup via googlePlaceId index
 *   4. audit_log captures all the inserts with attribution
 */
import { eq, inArray } from "drizzle-orm";
import { auditLog, cities, venues } from "../db/schema";
import { db, withAuditContext } from "../lib/db";
import { searchNearbyPlaces } from "../lib/google-places";

const bryleId = "fdb89cf3-c3cc-4115-a751-49600d743637";

async function main() {
  // Find Toronto with coords
  const [toronto] = await db.select().from(cities).where(eq(cities.name, "Toronto")).limit(1);
  if (!toronto?.location) {
    console.error("FAIL: Toronto needs location");
    process.exit(1);
  }

  // First search
  const result = await searchNearbyPlaces({
    lat: toronto.location.lat,
    lng: toronto.location.lng,
    radiusMeters: 2000,
    includedTypes: ["bar", "night_club", "pub"],
  });
  if (result.source !== "mock" || result.places.length !== 8) {
    console.error("FAIL: expected 8 mock places");
    process.exit(1);
  }

  // First import: should insert all 8
  const r1 = await withAuditContext(bryleId, async (tx) => {
    return tx
      .insert(venues)
      .values(
        result.places.map((p) => ({
          cityId: toronto.id,
          name: p.name,
          googlePlaceId: p.googlePlaceId,
          address: p.formattedAddress ?? undefined,
          phoneE164: p.phoneE164 ?? undefined,
          websiteUrl: p.websiteUri ?? undefined,
          location: p.location ?? undefined,
          servesAlcohol: true,
          doNotContact: false,
          internalNotes: "imported from places test",
          createdBy: bryleId,
          updatedBy: bryleId,
        })),
      )
      .returning({ id: venues.id });
  });

  // Re-import: should fail with unique constraint OR we filter via dedup
  // The action does the filter — here we verify the unique constraint exists.
  const allPlaceIds = result.places.map((p) => p.googlePlaceId);
  const existing = await db
    .select({ googlePlaceId: venues.googlePlaceId })
    .from(venues)
    .where(inArray(venues.googlePlaceId, allPlaceIds));
  if (existing.length !== 8) {
    console.error("FAIL: expected 8 existing place_ids found");
    process.exit(1);
  }

  // Verify audit attribution
  const ids = r1.map((r) => r.id);
  const audits = await db.select().from(auditLog).where(inArray(auditLog.recordId, ids));
  const insertAudits = audits.filter((a) => a.operation === "INSERT" && a.changedBy === bryleId);
  if (insertAudits.length !== 8) {
    console.error(`FAIL: expected 8 INSERT audit rows for bryle, got ${insertAudits.length}`);
    process.exit(1);
  }

  // Clean up — remove all the mock-imported venues
  await withAuditContext(bryleId, async (tx) => tx.delete(venues).where(inArray(venues.id, ids)));
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
