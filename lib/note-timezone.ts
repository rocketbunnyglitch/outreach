/**
 * Timezone resolution for smart-note actions.
 *
 * When a note says "call back today at 5pm", the engine must interpret
 * 5pm in SOME timezone. Resolution order (most specific first):
 *
 *   1. If note is on a venue → venue.city.timezone
 *   2. If note is on a venue_event → that venue's city timezone
 *   3. If note is on a city_campaign → that city's timezone
 *   4. If note is on a campaign → first city_campaign in that campaign
 *      (best-effort; campaigns don't have their own timezone column)
 *   5. Otherwise → author staff's timezone
 *   6. Final fallback → "America/Toronto" (your hub TZ)
 */

import { cities, cityCampaigns, staffMembers, venueEvents, venues } from "@/db/schema";
import { db } from "@/lib/db";
import { asc, eq } from "drizzle-orm";

const FALLBACK_TZ = "America/Toronto";

export async function resolveNoteTimezone(opts: {
  targetType: "venue" | "venue_event" | "city_campaign" | "campaign" | "event";
  targetId: string;
  authorStaffId: string;
}): Promise<{ timezone: string; venueId: string | null; phoneE164: string | null }> {
  const { targetType, targetId, authorStaffId } = opts;

  try {
    if (targetType === "venue") {
      const row = await db
        .select({
          venueId: venues.id,
          phone: venues.phoneE164,
          timezone: cities.timezone,
        })
        .from(venues)
        .innerJoin(cities, eq(cities.id, venues.cityId))
        .where(eq(venues.id, targetId))
        .limit(1)
        .then((r) => r[0]);
      if (row) {
        return { timezone: row.timezone, venueId: row.venueId, phoneE164: row.phone };
      }
    }

    if (targetType === "venue_event") {
      const row = await db
        .select({
          venueId: venues.id,
          phone: venues.phoneE164,
          timezone: cities.timezone,
        })
        .from(venueEvents)
        .innerJoin(venues, eq(venues.id, venueEvents.venueId))
        .innerJoin(cities, eq(cities.id, venues.cityId))
        .where(eq(venueEvents.id, targetId))
        .limit(1)
        .then((r) => r[0]);
      if (row) {
        return { timezone: row.timezone, venueId: row.venueId, phoneE164: row.phone };
      }
    }

    if (targetType === "city_campaign") {
      const row = await db
        .select({ timezone: cities.timezone })
        .from(cityCampaigns)
        .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
        .where(eq(cityCampaigns.id, targetId))
        .limit(1)
        .then((r) => r[0]);
      if (row) return { timezone: row.timezone, venueId: null, phoneE164: null };
    }

    if (targetType === "campaign") {
      // Best-effort: first city_campaign attached to this campaign
      const row = await db
        .select({ timezone: cities.timezone })
        .from(cityCampaigns)
        .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
        .where(eq(cityCampaigns.campaignId, targetId))
        .orderBy(asc(cities.name))
        .limit(1)
        .then((r) => r[0]);
      if (row) return { timezone: row.timezone, venueId: null, phoneE164: null };
    }
  } catch {
    /* fall through to author-staff fallback */
  }

  // Final fallback: author staff timezone
  try {
    const row = await db
      .select({ timezone: staffMembers.timezone })
      .from(staffMembers)
      .where(eq(staffMembers.id, authorStaffId))
      .limit(1)
      .then((r) => r[0]);
    if (row) return { timezone: row.timezone, venueId: null, phoneE164: null };
  } catch {
    /* */
  }

  return { timezone: FALLBACK_TZ, venueId: null, phoneE164: null };
}
