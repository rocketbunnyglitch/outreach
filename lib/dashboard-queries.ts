/**
 * Dashboard data queries.
 *
 * One module that gathers every piece of data the home dashboard needs.
 * Kept in a single file so:
 *   - We can profile and optimize as a single unit
 *   - Pages don't sprawl raw drizzle calls into the UI layer
 *   - The shape that comes out matches the props of the dashboard
 *     components exactly (no glue layer needed in page.tsx)
 *
 * Queries are parallelized where independent. None of these go through the
 * audit context — they're all read-only.
 */

import type {
  CampaignRow,
  CityRow,
  EventRow,
} from "@/app/(admin)/_components/dashboard/cities-table";
import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  countries,
  outreachLog,
  venueEvents,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";

const THIRTY_DAYS_AGO = sql`now() - interval '30 days'`;
const SEVEN_DAYS_AGO = sql`now() - interval '7 days'`;

export interface DashboardData {
  cityRows: CityRow[];
  kpis: {
    venuesConfirmed: number;
    venuesTargeted: number;
    salesCents: number;
    goalCents: number;
    outreachThisWeek: number;
    outreachPrevWeek: number;
    eventsConfirmed: number;
    eventsPlanned: number;
    replyRate: number; // 0-100 percentage
  };
}

export async function loadDashboardData(): Promise<DashboardData> {
  // ---- 1. Fetch all active city_campaigns with city + campaign info ----
  const cityCampaignRows = await db
    .select({
      cityCampaignId: cityCampaigns.id,
      cityId: cities.id,
      cityName: cities.name,
      cityRegion: cities.region,
      countryName: countries.name,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      campaignSlug: campaigns.slug,
      status: cityCampaigns.status,
      salesCents: cityCampaigns.currentSalesCents,
      goalCents: cityCampaigns.salesGoalCents,
      targetVenueCount: cityCampaigns.targetVenueCount,
    })
    .from(cityCampaigns)
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(countries, eq(countries.code, cities.countryCode))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .where(and(isNull(cities.archivedAt), isNull(campaigns.archivedAt)))
    .orderBy(asc(cities.name), asc(campaigns.name));

  // ---- 2. Fetch all events for these city-campaigns ----
  const cityCampaignIds = cityCampaignRows.map((r) => r.cityCampaignId);
  const eventRows =
    cityCampaignIds.length === 0
      ? []
      : await db
          .select({
            eventId: events.id,
            cityCampaignId: events.cityCampaignId,
            eventDate: events.eventDate,
            slotNumber: events.slotNumber,
            status: events.status,
            requiredVenueCountTotal: events.requiredVenueCountTotal,
            requiredWristbandCount: events.requiredWristbandCount,
            requiredMiddleCount: events.requiredMiddleCount,
            requiredFinalCount: events.requiredFinalCount,
          })
          .from(events)
          .where(isNull(events.archivedAt))
          .orderBy(asc(events.eventDate), asc(events.slotNumber));

  // ---- 3. Venue counts per event (with role breakdown) ----
  const eventIds = eventRows.map((r) => r.eventId);
  const venueEventCountsRaw =
    eventIds.length === 0
      ? []
      : await db
          .select({
            eventId: venueEvents.eventId,
            role: venueEvents.role,
            status: venueEvents.status,
            count: sql<number>`count(*)::int`,
          })
          .from(venueEvents)
          .groupBy(venueEvents.eventId, venueEvents.role, venueEvents.status);

  // ---- 4. Daily outreach activity per city (last 30 days) ----
  // Group outreach_log by city via the venue's city.
  // SELECT venues.city_id, date_trunc('day', outreach_log.created_at) AS day, count(*)
  //
  // We use a raw join through venues because outreach_log has venue_id, not city_id.
  const cityIds = cityCampaignRows.map((r) => r.cityId);
  const outreachByDayRaw =
    cityIds.length === 0
      ? []
      : await db.execute<{
          city_id: string;
          day: Date;
          count: number;
        }>(sql`
        SELECT
          v.city_id,
          date_trunc('day', ol.created_at) AS day,
          COUNT(*)::int AS count
        FROM outreach_log ol
        JOIN venues v ON v.id = ol.venue_id
        WHERE ol.created_at >= now() - interval '30 days'
          AND v.city_id = ANY(${sql.raw(`ARRAY[${cityIds.map((id) => `'${id}'::uuid`).join(",")}]`)})
        GROUP BY v.city_id, day
        ORDER BY day
      `);
  // pg's QueryResult has a .rows array; normalize either branch into a flat array
  const outreachByDay: Array<{ city_id: string; day: Date; count: number }> = Array.isArray(
    outreachByDayRaw,
  )
    ? outreachByDayRaw
    : ((
        outreachByDayRaw as unknown as {
          rows: Array<{ city_id: string; day: Date; count: number }>;
        }
      ).rows ?? []);

  // ---- 5. KPI rollups (parallel) ----
  const [
    confirmedVenuesResult,
    outreachThisWeekResult,
    outreachPrevWeekResult,
    replyStatsResult,
    eventStatsResult,
  ] = await Promise.all([
    db
      .select({
        confirmedVenues: sql<number>`count(*)::int`,
      })
      .from(venueEvents)
      .where(eq(venueEvents.status, "confirmed")),
    db
      .select({
        outreachThisWeek: sql<number>`count(*)::int`,
      })
      .from(outreachLog)
      .where(gte(outreachLog.createdAt, SEVEN_DAYS_AGO as never)),
    db
      .select({
        outreachPrevWeek: sql<number>`count(*)::int`,
      })
      .from(outreachLog)
      .where(
        and(
          gte(outreachLog.createdAt, sql`now() - interval '14 days'` as never),
          sql`${outreachLog.createdAt} < now() - interval '7 days'`,
        ),
      ),
    db
      .select({
        replyCount: sql<number>`count(*) filter (where outcome in ('replied','positive'))::int`,
        totalOutreachCount: sql<number>`count(*)::int`,
      })
      .from(outreachLog)
      .where(gte(outreachLog.createdAt, THIRTY_DAYS_AGO as never)),
    db
      .select({
        confirmedEvents: sql<number>`count(*) filter (where status = 'confirmed')::int`,
        plannedEvents: sql<number>`count(*) filter (where status = 'planned')::int`,
      })
      .from(events)
      .where(isNull(events.archivedAt)),
  ]);

  const confirmedVenues = Number(confirmedVenuesResult[0]?.confirmedVenues ?? 0);
  const outreachThisWeek = Number(outreachThisWeekResult[0]?.outreachThisWeek ?? 0);
  const outreachPrevWeek = Number(outreachPrevWeekResult[0]?.outreachPrevWeek ?? 0);
  const replyCount = Number(replyStatsResult[0]?.replyCount ?? 0);
  const totalOutreachCount = Number(replyStatsResult[0]?.totalOutreachCount ?? 0);
  const confirmedEvents = Number(eventStatsResult[0]?.confirmedEvents ?? 0);
  const plannedEvents = Number(eventStatsResult[0]?.plannedEvents ?? 0);

  // ---- 6. Assemble city → campaigns → events tree ----
  // Index venue counts: eventId → { confirmed, byRole }
  const venueByEvent = new Map<
    string,
    {
      total: number;
      wristbandFilled: number;
      middleFilled: number;
      finalFilled: number;
    }
  >();
  for (const row of venueEventCountsRaw) {
    const bucket = venueByEvent.get(row.eventId) ?? {
      total: 0,
      wristbandFilled: 0,
      middleFilled: 0,
      finalFilled: 0,
    };
    bucket.total += Number(row.count);
    if (row.status === "confirmed") {
      if (row.role === "wristband") bucket.wristbandFilled += Number(row.count);
      if (row.role === "middle") bucket.middleFilled += Number(row.count);
      if (row.role === "final") bucket.finalFilled += Number(row.count);
    }
    venueByEvent.set(row.eventId, bucket);
  }

  // Build per-city-campaign event lists
  const eventsByCC = new Map<string, EventRow[]>();
  for (const er of eventRows) {
    const bucket = venueByEvent.get(er.eventId) ?? {
      total: 0,
      wristbandFilled: 0,
      middleFilled: 0,
      finalFilled: 0,
    };
    const list = eventsByCC.get(er.cityCampaignId) ?? [];
    list.push({
      eventId: er.eventId,
      eventDate: er.eventDate,
      slotNumber: er.slotNumber,
      status: er.status as EventRow["status"],
      venuesLinked: bucket.total,
      venuesRequired: er.requiredVenueCountTotal ?? 0,
      wristbandFilled: bucket.wristbandFilled,
      middleFilled: bucket.middleFilled,
      finalFilled: bucket.finalFilled,
      wristbandRequired: er.requiredWristbandCount ?? 0,
      middleRequired: er.requiredMiddleCount ?? 0,
      finalRequired: er.requiredFinalCount ?? 0,
    });
    eventsByCC.set(er.cityCampaignId, list);
  }

  // Group city_campaigns by city
  const citiesMap = new Map<string, CityRow>();
  for (const cc of cityCampaignRows) {
    const ccEvents = eventsByCC.get(cc.cityCampaignId) ?? [];
    const venuesConfirmed = ccEvents.reduce(
      (sum, e) => sum + e.wristbandFilled + e.middleFilled + e.finalFilled,
      0,
    );
    const campaignRow: CampaignRow = {
      cityCampaignId: cc.cityCampaignId,
      campaignName: cc.campaignName,
      campaignSlug: cc.campaignSlug,
      status: cc.status as CampaignRow["status"],
      salesCents: Number(cc.salesCents ?? 0),
      goalCents: Number(cc.goalCents ?? 0),
      venuesConfirmed,
      venuesTargeted: cc.targetVenueCount,
      events: ccEvents,
    };

    let city = citiesMap.get(cc.cityId);
    if (!city) {
      city = {
        cityId: cc.cityId,
        cityName: cc.cityName,
        cityRegion: cc.cityRegion,
        countryName: cc.countryName,
        campaigns: [],
        totalSalesCents: 0,
        totalGoalCents: 0,
        venuesConfirmed: 0,
        venuesTargeted: 0,
        outreach30d: build30DaySeries(outreachByDay, cc.cityId),
        rollupStatus: "planning",
      };
      citiesMap.set(cc.cityId, city);
    }
    city.campaigns.push(campaignRow);
    city.totalSalesCents += campaignRow.salesCents;
    city.totalGoalCents += campaignRow.goalCents;
    city.venuesConfirmed += venuesConfirmed;
    city.venuesTargeted += campaignRow.venuesTargeted;
  }

  // Compute roll-up status: city is "active"/"confirmed" if any campaign is,
  // otherwise the highest-priority status across campaigns
  for (const city of citiesMap.values()) {
    const statuses = city.campaigns.map((c) => c.status);
    if (statuses.includes("confirmed")) city.rollupStatus = "confirmed";
    else if (statuses.includes("active")) city.rollupStatus = "active";
    else if (statuses.every((s) => s === "cancelled")) city.rollupStatus = "cancelled";
    else city.rollupStatus = "planning";
  }

  const cityRows = Array.from(citiesMap.values());

  // ---- 7. Targeted venue total for KPI ----
  const venuesTargeted = cityRows.reduce((sum, c) => sum + c.venuesTargeted, 0);
  const totalSalesCents = cityRows.reduce((sum, c) => sum + c.totalSalesCents, 0);
  const totalGoalCents = cityRows.reduce((sum, c) => sum + c.totalGoalCents, 0);
  const replyRate =
    totalOutreachCount > 0 ? Math.round((replyCount / totalOutreachCount) * 100) : 0;

  return {
    cityRows,
    kpis: {
      venuesConfirmed: confirmedVenues,
      venuesTargeted,
      salesCents: totalSalesCents,
      goalCents: totalGoalCents,
      outreachThisWeek,
      outreachPrevWeek,
      eventsConfirmed: confirmedEvents,
      eventsPlanned: plannedEvents,
      replyRate,
    },
  };
}

/**
 * Build a length-30 array of daily outreach counts for one city, padded
 * with zeros for days that had no activity.
 *
 * The data from Postgres only includes days where COUNT(*) > 0; we
 * normalize to a fixed-length time series here so the sparkline always
 * renders 30 datapoints.
 */
function build30DaySeries(
  raw: ReadonlyArray<{ city_id: string; day: Date; count: number }>,
  cityId: string,
): number[] {
  const cityData = raw.filter((r) => r.city_id === cityId);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const result: number[] = [];
  for (let i = 29; i >= 0; i--) {
    const target = new Date(today);
    target.setUTCDate(target.getUTCDate() - i);
    const match = cityData.find((r) => new Date(r.day).getTime() === target.getTime());
    result.push(match ? Number(match.count) : 0);
  }
  return result;
}
