import "server-only";

/**
 * Health/viability -- server read path. [CRM buildout, Phase 1.1/2]
 *
 * Thin wrapper over the pure core (lib/health-score-core.ts): it fetches the
 * real inputs (ticket sales, slot fill by role, days-to-event, floor-staff
 * readiness) and hands them to the graders. The deterministic logic + the unit
 * tests live in the core; this module only does the indexed DB reads and the
 * assembly, mirroring the shape of lib/dashboard-queries.ts so we reuse the
 * same aggregation the dashboard already trusts.
 */

import {
  events,
  campaignConnectedAccounts,
  campaigns,
  cities,
  cityCampaigns,
  connectedAccounts,
  crawlHosts,
  emailThreads,
  venueEvents,
  wristbands,
} from "@/db/schema";
import { db } from "@/lib/db";
import {
  type CrawlHealth,
  type HealthColor,
  type HealthScore,
  campaignHealthFromInputs,
  cityHealthFromInputs,
  crawlHealthFromInputs,
} from "@/lib/health-score-core";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { cache } from "react";

export interface CrawlHealthRow {
  eventId: string;
  cityCampaignId: string;
  cityName: string;
  /** Short human label, e.g. "Fri Night #2 · Oct 31". */
  label: string;
  eventDate: string;
  daysToEvent: number | null;
  ticketsSold: number;
  health: CrawlHealth;
}

export interface CityHealthRow {
  cityCampaignId: string;
  cityName: string;
  campaignName: string;
  health: HealthScore;
  crawls: CrawlHealthRow[];
}

export interface CampaignHealthSummary {
  campaign: HealthScore;
  cities: CityHealthRow[];
  /** Flat list of every not-green crawl, worst first -- the command center. */
  atRiskCrawls: CrawlHealthRow[];
}

/** Within this many days of the event, an un-briefed confirmed venue makes the
 *  whole crawl a readiness blocker (matches READINESS_BLOCKER_WINDOW_DAYS). */
const READINESS_WINDOW_DAYS = 4;

const COLOR_RANK: Record<HealthColor, number> = { red: 0, yellow: 1, green: 2 };

const DAY_PART_LABEL: Record<string, string> = {
  thursday_night: "Thu Night",
  friday_night: "Fri Night",
  saturday_day: "Sat Day",
  saturday_night: "Sat Night",
  sunday_day: "Sun Day",
  sunday_night: "Sun Night",
  other: "Crawl",
};

function emptySummary(): CampaignHealthSummary {
  return {
    campaign: {
      score: 100,
      color: "green",
      statusLabel: "On track",
      reasons: [],
      blockers: [],
      nextAction: null,
    },
    cities: [],
    atRiskCrawls: [],
  };
}

/** "2026-10-31" -> "Oct 31" (UTC-pinned -- the column is a plain date). */
function shortDate(eventDate: string): string {
  const d = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return eventDate;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function crawlLabel(dayPart: string | null, crawlNumber: number | null, eventDate: string): string {
  const part = (dayPart && DAY_PART_LABEL[dayPart]) || "Crawl";
  const num = crawlNumber && crawlNumber > 1 ? ` #${crawlNumber}` : "";
  return `${part}${num} · ${shortDate(eventDate)}`;
}

/**
 * Grade every crawl in scope, roll up to city + campaign, and surface the
 * at-risk crawls. Scope mirrors the dashboard: a single campaign when
 * campaignId is set, every active campaign when null.
 *
 * Wrapped in React cache(): the dashboard render calls this directly (the
 * command-center card) AND through loadNextBestActions (the C1 health
 * boost) — cache() dedupes to ONE execution per request instead of running
 * the whole aggregate stack twice.
 */
export const loadCampaignHealth = cache(async function loadCampaignHealthImpl(
  campaignId: string | null,
): Promise<CampaignHealthSummary> {
  const campaignFilter = campaignId ? eq(cityCampaigns.campaignId, campaignId) : undefined;

  // 1. City-campaigns in scope (city + campaign names for the rollup labels).
  const ccRows = await db
    .select({
      cityCampaignId: cityCampaigns.id,
      cityName: cities.name,
      campaignName: campaigns.name,
    })
    .from(cityCampaigns)
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .where(and(isNull(cities.archivedAt), isNull(campaigns.archivedAt), campaignFilter))
    .orderBy(asc(cities.name));

  if (ccRows.length === 0) return emptySummary();
  const ccIds = ccRows.map((r) => r.cityCampaignId);

  // 2. Events (= crawls) for those city-campaigns, with required slot counts,
  //    format, ticket sales and a server-computed days-to-event.
  const eventRows = await db
    .select({
      eventId: events.id,
      cityCampaignId: events.cityCampaignId,
      eventDate: events.eventDate,
      dayPart: events.dayPart,
      crawlNumber: events.crawlNumber,
      status: events.status,
      crawlFormat: events.crawlFormat,
      ticketsSold: events.ticketSalesCount,
      wristbandRequired: events.requiredWristbandCount,
      middleRequired: events.requiredMiddleCount,
      finalRequired: events.requiredFinalCount,
      // Toronto day, not UTC: the VPS runs UTC, so a bare now()::date rolls at
      // 8pm Toronto -- tonight's crawl would vanish from health mid-evening.
      daysToEvent: sql<
        number | null
      >`(${events.eventDate} - (now() at time zone 'America/Toronto')::date)`,
    })
    .from(events)
    .where(
      and(
        isNull(events.archivedAt),
        inArray(events.cityCampaignId, ccIds),
        // Health is forward-looking: a crawl already in the past is history,
        // not something to action today. Excludes stale/never-run events from
        // the command center.
        sql`${events.eventDate} >= (now() at time zone 'America/Toronto')::date`,
      ),
    )
    .orderBy(asc(events.eventDate));

  if (eventRows.length === 0) return emptySummary();
  const eventIds = eventRows.map((r) => r.eventId);

  // 3. Confirmed venue_events per (event, role) = filled slots. Plus, per
  //    event: confirmed venues lacking a floor-staff briefing, confirmed
  //    venues with no our-contact owner, host assignments, unshipped
  //    wristbands (CRM plan C1), and stale warm replies + sending-inbox
  //    issues for the rollups.
  const [fillRows, briefRows, hostRows, wristbandRows, warmRows, sendingIssueRows] =
    await Promise.all([
      db
        .select({
          eventId: venueEvents.eventId,
          role: venueEvents.role,
          confirmed: sql<number>`count(*) filter (where ${venueEvents.status} = 'confirmed')::int`,
        })
        .from(venueEvents)
        .where(inArray(venueEvents.eventId, eventIds))
        .groupBy(venueEvents.eventId, venueEvents.role),
      db
        .select({
          eventId: venueEvents.eventId,
          confirmed: sql<number>`count(*) filter (where ${venueEvents.status} = 'confirmed')::int`,
          unbriefed: sql<number>`count(*) filter (where ${venueEvents.status} = 'confirmed' and ${venueEvents.floorStaffCallCompletedAt} is null)::int`,
          unowned: sql<number>`count(*) filter (where ${venueEvents.status} = 'confirmed' and ${venueEvents.ourContactStaffId} is null)::int`,
        })
        .from(venueEvents)
        .where(inArray(venueEvents.eventId, eventIds))
        .groupBy(venueEvents.eventId),
      db
        .select({
          eventId: crawlHosts.eventId,
          hosts: sql<number>`count(*)::int`,
        })
        .from(crawlHosts)
        .where(inArray(crawlHosts.eventId, eventIds))
        .groupBy(crawlHosts.eventId),
      db
        .select({
          eventId: venueEvents.eventId,
          pending: sql<number>`count(*)::int`,
        })
        .from(wristbands)
        .innerJoin(venueEvents, eq(venueEvents.id, wristbands.venueEventId))
        .where(
          and(
            inArray(venueEvents.eventId, eventIds),
            inArray(wristbands.status, ["pending", "ready_to_ship", "issue"]),
          ),
        )
        .groupBy(venueEvents.eventId),
      // Warm replies waiting >48h per city-campaign (the city-level rot
      // signal — same definition the NBA warm-reply loader uses, longer
      // window so only true rot drags health).
      db
        .select({
          cityCampaignId: emailThreads.cityCampaignId,
          stale: sql<number>`count(*)::int`,
        })
        .from(emailThreads)
        .where(
          and(
            inArray(emailThreads.cityCampaignId, ccIds),
            eq(emailThreads.state, "needs_reply"),
            isNull(emailThreads.deletedAt),
            sql`${emailThreads.classification}::text IN ('interested', 'warm', 'question', 'callback_requested')`,
            sql`${emailThreads.lastInboundAt} < now() - interval '48 hours'`,
          ),
        )
        .groupBy(emailThreads.cityCampaignId),
      // Sending inboxes on the scoped campaign(s) that are not connected.
      db
        .select({
          campaignId: campaignConnectedAccounts.campaignId,
          broken: sql<number>`count(*)::int`,
        })
        .from(campaignConnectedAccounts)
        .innerJoin(
          connectedAccounts,
          eq(connectedAccounts.id, campaignConnectedAccounts.connectedAccountId),
        )
        .where(
          and(
            sql`${connectedAccounts.status}::text <> 'connected'`,
            campaignId ? eq(campaignConnectedAccounts.campaignId, campaignId) : undefined,
          ),
        )
        .groupBy(campaignConnectedAccounts.campaignId),
    ]);

  const fillByEvent = new Map<string, { wristband: number; middle: number; final: number }>();
  for (const r of fillRows) {
    const b = fillByEvent.get(r.eventId) ?? { wristband: 0, middle: 0, final: 0 };
    if (r.role === "wristband") b.wristband += Number(r.confirmed);
    else if (r.role === "middle") b.middle += Number(r.confirmed);
    else if (r.role === "final") b.final += Number(r.confirmed);
    fillByEvent.set(r.eventId, b);
  }
  const briefByEvent = new Map<string, number>();
  const unownedByEvent = new Map<string, number>();
  for (const r of briefRows) {
    briefByEvent.set(r.eventId, Number(r.unbriefed));
    unownedByEvent.set(r.eventId, Number(r.unowned));
  }
  const hostsByEvent = new Map(hostRows.map((r) => [r.eventId, Number(r.hosts)]));
  const wristbandPendingByEvent = new Map(wristbandRows.map((r) => [r.eventId, Number(r.pending)]));
  const staleWarmByCC = new Map(
    warmRows
      .filter((r) => r.cityCampaignId != null)
      .map((r) => [r.cityCampaignId as string, Number(r.stale)]),
  );
  const sendingIssues = sendingIssueRows.reduce((s, r) => s + Number(r.broken), 0);

  // 4. Grade each crawl, group into cities.
  const crawlsByCC = new Map<string, CrawlHealthRow[]>();
  const ccNameById = new Map(ccRows.map((r) => [r.cityCampaignId, r]));

  for (const e of eventRows) {
    const fill = fillByEvent.get(e.eventId) ?? { wristband: 0, middle: 0, final: 0 };
    const days = e.daysToEvent != null ? Number(e.daysToEvent) : null;
    const unbriefed = briefByEvent.get(e.eventId) ?? 0;
    const readinessBlocker =
      e.status === "confirmed" &&
      days != null &&
      days >= 0 &&
      days <= READINESS_WINDOW_DAYS &&
      unbriefed > 0;

    const health = crawlHealthFromInputs({
      eventStatus: e.status as "planned" | "confirmed" | "completed" | "cancelled",
      crawlFormat: e.crawlFormat as "standard" | "day_party",
      ticketsSold: e.ticketsSold ?? 0,
      daysToEvent: days,
      wristbandRequired: e.wristbandRequired ?? 0,
      wristbandFilled: fill.wristband,
      middleRequired: e.middleRequired ?? 0,
      middleFilled: fill.middle,
      finalRequired: e.finalRequired ?? 0,
      finalFilled: fill.final,
      readinessBlocker,
      readinessBlockerReason: readinessBlocker
        ? `${unbriefed} confirmed venue${unbriefed > 1 ? "s" : ""} not briefed -- event in ${days}d`
        : null,
      hostsAssigned: hostsByEvent.get(e.eventId) ?? 0,
      wristbandsPending: (wristbandPendingByEvent.get(e.eventId) ?? 0) > 0,
      unassignedConfirmed: unownedByEvent.get(e.eventId) ?? 0,
    });

    const cc = ccNameById.get(e.cityCampaignId);
    const row: CrawlHealthRow = {
      eventId: e.eventId,
      cityCampaignId: e.cityCampaignId,
      cityName: cc?.cityName ?? "Unknown city",
      label: crawlLabel(e.dayPart, e.crawlNumber, e.eventDate),
      eventDate: e.eventDate,
      daysToEvent: days,
      ticketsSold: e.ticketsSold ?? 0,
      health,
    };
    const list = crawlsByCC.get(e.cityCampaignId) ?? [];
    list.push(row);
    crawlsByCC.set(e.cityCampaignId, list);
  }

  // 5. City rollups + campaign rollup.
  const cityRows: CityHealthRow[] = [];
  for (const cc of ccRows) {
    const crawls = crawlsByCC.get(cc.cityCampaignId);
    if (!crawls || crawls.length === 0) continue;
    const totalTicketsSold = crawls.reduce((s, c) => s + c.ticketsSold, 0);
    const health = cityHealthFromInputs({
      crawls: crawls.map((c) => c.health),
      totalTicketsSold,
      staleWarmLeads: staleWarmByCC.get(cc.cityCampaignId) ?? 0,
    });
    cityRows.push({
      cityCampaignId: cc.cityCampaignId,
      cityName: cc.cityName,
      campaignName: cc.campaignName,
      health,
      crawls,
    });
  }

  const campaign = campaignHealthFromInputs({
    cities: cityRows.map((c) => c.health),
    sendingIssues,
  });

  const atRiskCrawls = cityRows
    .flatMap((c) => c.crawls)
    .filter((c) => c.health.color !== "green")
    .sort((a, b) => {
      const rank = COLOR_RANK[a.health.color] - COLOR_RANK[b.health.color];
      if (rank !== 0) return rank;
      return a.health.score - b.health.score;
    });

  return { campaign, cities: cityRows, atRiskCrawls };
});
