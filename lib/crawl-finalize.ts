import "server-only";

/**
 * Crawl-finalization detection (migration 0133, operator request 2026-06-10).
 *
 * "Finalized" = this venue confirmation filled the LAST required slot of the
 * crawl, completing the lineup. First finalizer wins (ON CONFLICT DO
 * NOTHING on the event PK), so re-confirms and later edits never re-award
 * it. The caller (updateVenueEvent post-commit) broadcasts the big
 * "%name% finalized %city%!" quick win and the admin leaderboard counts
 * rows from this table.
 */

import { events, cities, cityCampaigns, crawlFinalizations, venueEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, count, eq, inArray } from "drizzle-orm";

const CONFIRMED_FAMILY = ["confirmed", "scheduled", "contract_signed"] as const;

export interface CrawlFinalized {
  eventId: string;
  cityName: string;
  eventDate: string;
}

/** Returns finalization info when THIS confirmation completed the crawl and
 *  this is the first time it completed; null otherwise. Never throws. */
export async function maybeRecordCrawlFinalization(opts: {
  venueEventId: string;
  staffId: string;
}): Promise<CrawlFinalized | null> {
  try {
    const [ve] = await db
      .select({ eventId: venueEvents.eventId })
      .from(venueEvents)
      .where(eq(venueEvents.id, opts.venueEventId))
      .limit(1);
    if (!ve) return null;

    const [ev] = await db
      .select({
        id: events.id,
        eventDate: events.eventDate,
        cityCampaignId: events.cityCampaignId,
        wristbandReq: events.requiredWristbandCount,
        middleReq: events.requiredMiddleCount,
        finalReq: events.requiredFinalCount,
      })
      .from(events)
      .where(eq(events.id, ve.eventId))
      .limit(1);
    if (!ev) return null;

    const filled = await db
      .select({ role: venueEvents.role, n: count() })
      .from(venueEvents)
      .where(
        and(eq(venueEvents.eventId, ev.id), inArray(venueEvents.status, [...CONFIRMED_FAMILY])),
      )
      .groupBy(venueEvents.role);
    const by = new Map(filled.map((f) => [f.role, Number(f.n)]));
    const complete =
      (by.get("wristband") ?? 0) >= ev.wristbandReq &&
      (by.get("middle") ?? 0) >= ev.middleReq &&
      (ev.finalReq === 0 || (by.get("final") ?? 0) >= ev.finalReq);
    if (!complete) return null;

    const inserted = await db
      .insert(crawlFinalizations)
      .values({ eventId: ev.id, staffId: opts.staffId, cityCampaignId: ev.cityCampaignId })
      .onConflictDoNothing({ target: crawlFinalizations.eventId })
      .returning({ eventId: crawlFinalizations.eventId });
    if (!inserted[0]) return null; // someone already finalized it

    const [cc] = await db
      .select({ cityName: cities.name })
      .from(cityCampaigns)
      .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .where(eq(cityCampaigns.id, ev.cityCampaignId))
      .limit(1);

    return {
      eventId: ev.id,
      cityName: cc?.cityName ?? "a city",
      eventDate: String(ev.eventDate ?? ""),
    };
  } catch (err) {
    logger.warn({ err, venueEventId: opts.venueEventId }, "crawl-finalize check failed");
    return null;
  }
}
