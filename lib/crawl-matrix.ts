/**
 * Crawl Matrix query — one row per crawl instance across a campaign.
 *
 * For the International Halloween model, the operator needs to see all
 * crawls at once:
 *
 *   City     | Daypart    | Crawl # | Tickets | Wristband | Middle  | Final
 *   ---------+------------+---------+---------+-----------+---------+------
 *   NYC      | Fri Night  | 1       | 42      | Confirmed | Group A | Confirmed
 *   NYC      | Fri Night  | 2       | 38      | Confirmed | Group A | Missing
 *   ...
 *
 * Each row's "status" rolls up:
 *   - Complete: all three roles filled
 *   - Need final/middle/wristband: one or more missing
 *   - At risk: tickets sold but venues missing
 *   - Outreach: nothing confirmed yet
 *   - Stale: no outreach activity in 5 days
 *
 * Status calculation is in the query helper since it drives sorting +
 * filtering.
 */

import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  middleVenueGroupMembers,
  middleVenueGroups,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

export type CrawlStatus =
  | "complete"
  | "need_final"
  | "need_middle"
  | "need_wristband"
  | "at_risk"
  | "outreach"
  | "stale";

export interface CrawlMatrixRow {
  eventId: string;
  cityCampaignId: string;
  cityId: string;
  cityName: string;
  campaignName: string;
  dayPart: string | null;
  /** Friendly label, e.g. 'Fri Night #2' */
  crawlLabel: string;
  crawlNumber: number | null;
  eventDate: string;
  ticketSalesCount: number;
  /** Wristband venue name (confirmed only), or null. */
  wristbandVenueName: string | null;
  wristbandStatus: "confirmed" | "missing" | "pending";
  /** Middle group name + member count, or null when no group attached. */
  middleGroupName: string | null;
  middleGroupId: string | null;
  middleVenueCount: number;
  middleStatus: "confirmed" | "missing" | "pending";
  /** Final venue name (confirmed only), or null. */
  finalVenueName: string | null;
  finalStatus: "confirmed" | "missing" | "pending";
  status: CrawlStatus;
  /** True when no outreach activity for this city in the past 5 days. */
  stale: boolean;
}

/**
 * Build the matrix for a campaign (or all active campaigns if null).
 */
export async function buildCrawlMatrix(opts: {
  campaignId: string | null;
}): Promise<CrawlMatrixRow[]> {
  const { campaignId } = opts;

  // 1. Pull all events in scope with their city + campaign + middle group
  const eventRows = await db
    .select({
      eventId: events.id,
      cityCampaignId: events.cityCampaignId,
      cityId: cities.id,
      cityName: cities.name,
      campaignName: campaigns.name,
      campaignId: campaigns.id,
      dayPart: events.dayPart,
      crawlNumber: events.crawlNumber,
      eventDate: events.eventDate,
      ticketSalesCount: events.ticketSalesCount,
      middleGroupId: events.middleVenueGroupId,
      middleGroupName: middleVenueGroups.name,
    })
    .from(events)
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .leftJoin(middleVenueGroups, eq(middleVenueGroups.id, events.middleVenueGroupId))
    .where(
      and(
        isNull(events.archivedAt),
        isNull(campaigns.archivedAt),
        campaignId ? eq(campaigns.id, campaignId) : undefined,
      ),
    );

  if (eventRows.length === 0) return [];

  const eventIds = eventRows.map((r) => r.eventId);
  const middleGroupIds = eventRows.map((r) => r.middleGroupId).filter((id): id is string => !!id);

  // 2. Per-event venue_events with role + venue name, status=confirmed only
  //    (for the wristband/final lookups). Plus a count of confirmed
  //    middles per event for the inline-middle fallback case.
  const veRows = await db
    .select({
      eventId: venueEvents.eventId,
      venueId: venueEvents.venueId,
      venueName: venues.name,
      role: venueEvents.role,
      status: venueEvents.status,
    })
    .from(venueEvents)
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .where(inArray(venueEvents.eventId, eventIds));

  // 3. Member venue counts per middle group (confirmed only)
  const memberCounts =
    middleGroupIds.length === 0
      ? []
      : await db
          .select({
            groupId: middleVenueGroupMembers.middleVenueGroupId,
            count: sql<number>`count(*) filter (where status = 'confirmed')::int`,
          })
          .from(middleVenueGroupMembers)
          .where(inArray(middleVenueGroupMembers.middleVenueGroupId, middleGroupIds))
          .groupBy(middleVenueGroupMembers.middleVenueGroupId);

  const memberCountMap = new Map(memberCounts.map((m) => [m.groupId, m.count]));

  // 4. Staleness: any outreach activity per cityCampaign in the last 5 days?
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const recentOutreachRows = await db.execute<{ city_campaign_id: string }>(sql`
    SELECT DISTINCT cc.id AS city_campaign_id
    FROM outreach_log ol
    JOIN venues v ON v.id = ol.venue_id
    JOIN city_campaigns cc ON cc.city_id = v.city_id
    WHERE ol.created_at >= ${fiveDaysAgo.toISOString()}
      AND cc.id = ANY(${sql.raw(
        `ARRAY[${eventRows.map((r) => `'${r.cityCampaignId}'`).join(",")}]::uuid[]`,
      )})
  `);
  type ROCRow = { city_campaign_id: string };
  const recentList: ROCRow[] = Array.isArray(recentOutreachRows)
    ? (recentOutreachRows as unknown as ROCRow[])
    : ((recentOutreachRows as unknown as { rows: ROCRow[] }).rows ?? []);
  const ccWithRecentOutreach = new Set(recentList.map((r) => r.city_campaign_id));

  // 5. Bucket venue_events by event
  type VE = (typeof veRows)[number];
  const veByEvent = new Map<string, VE[]>();
  for (const v of veRows) {
    const list = veByEvent.get(v.eventId) ?? [];
    list.push(v);
    veByEvent.set(v.eventId, list);
  }

  // 6. Assemble rows
  return eventRows.map((er) => {
    const ves = veByEvent.get(er.eventId) ?? [];
    const wristband = ves.find((v) => v.role === "wristband");
    const final = ves.find((v) => v.role === "final");
    const inlineMiddles = ves.filter((v) => v.role === "middle");

    const wristbandStatus: CrawlMatrixRow["wristbandStatus"] = !wristband
      ? "missing"
      : wristband.status === "confirmed"
        ? "confirmed"
        : "pending";

    const finalStatus: CrawlMatrixRow["finalStatus"] = !final
      ? "missing"
      : final.status === "confirmed"
        ? "confirmed"
        : "pending";

    // Middle status: prefer group (Halloween model). Fall back to inline.
    let middleStatus: CrawlMatrixRow["middleStatus"] = "missing";
    let middleVenueCount = 0;
    if (er.middleGroupId) {
      const count = memberCountMap.get(er.middleGroupId) ?? 0;
      middleVenueCount = count;
      middleStatus = count > 0 ? "confirmed" : "pending";
    } else if (inlineMiddles.length > 0) {
      const confirmedCount = inlineMiddles.filter((v) => v.status === "confirmed").length;
      middleVenueCount = confirmedCount;
      middleStatus = confirmedCount > 0 ? "confirmed" : "pending";
    }

    const stale = !ccWithRecentOutreach.has(er.cityCampaignId);

    // Roll-up status
    let status: CrawlStatus = "outreach";
    const allConfirmed =
      wristbandStatus === "confirmed" &&
      middleStatus === "confirmed" &&
      finalStatus === "confirmed";

    if (allConfirmed) {
      status = "complete";
    } else if (
      er.ticketSalesCount > 0 &&
      (wristbandStatus === "missing" || finalStatus === "missing")
    ) {
      status = "at_risk";
    } else if (finalStatus === "missing") {
      status = "need_final";
    } else if (middleStatus === "missing") {
      status = "need_middle";
    } else if (wristbandStatus === "missing") {
      status = "need_wristband";
    } else if (stale) {
      status = "stale";
    } else {
      status = "outreach";
    }

    const crawlLabel = er.dayPart
      ? `${formatDayPart(er.dayPart)}${er.crawlNumber ? ` #${er.crawlNumber}` : ""}`
      : `Slot ${er.crawlNumber ?? "—"}`;

    return {
      eventId: er.eventId,
      cityCampaignId: er.cityCampaignId,
      cityId: er.cityId,
      cityName: er.cityName,
      campaignName: er.campaignName,
      dayPart: er.dayPart,
      crawlLabel,
      crawlNumber: er.crawlNumber,
      eventDate: er.eventDate,
      ticketSalesCount: er.ticketSalesCount,
      wristbandVenueName: wristband?.venueName ?? null,
      wristbandStatus,
      middleGroupName: er.middleGroupName,
      middleGroupId: er.middleGroupId,
      middleVenueCount,
      middleStatus,
      finalVenueName: final?.venueName ?? null,
      finalStatus,
      status,
      stale,
    };
  });
}

function formatDayPart(dp: string): string {
  switch (dp) {
    case "thursday_night":
      return "Thu Night";
    case "friday_night":
      return "Fri Night";
    case "saturday_day":
      return "Sat Day";
    case "saturday_night":
      return "Sat Night";
    case "sunday_day":
      return "Sun Day";
    case "sunday_night":
      return "Sun Night";
    default:
      return dp;
  }
}
