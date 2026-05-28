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
  staffMembers,
  tasks,
  venueEvents,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";

const THIRTY_DAYS_AGO = sql`now() - interval '30 days'`;
const SEVEN_DAYS_AGO = sql`now() - interval '7 days'`;

export interface UpcomingTaskRow {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  dueAt: Date | null;
  assigneeName: string | null;
  overdue: boolean;
}

export interface RecentNoteRow {
  id: string;
  body: string;
  authorName: string;
  targetType: "venue" | "city_campaign" | "campaign";
  targetId: string;
  targetName: string;
  mentionCount: number;
  createdAt: Date;
}

export interface DashboardData {
  cityRows: CityRow[];
  upcomingTasks: UpcomingTaskRow[];
  recentNotes: RecentNoteRow[];
  kpis: {
    venuesConfirmed: number;
    venuesTargeted: number;
    salesCents: number;
    goalCents: number;
    /** Total tickets sold across all events in scope. Operational primary. */
    ticketsSold: number;
    outreachThisWeek: number;
    outreachPrevWeek: number;
    eventsConfirmed: number;
    eventsPlanned: number;
    replyRate: number; // 0-100 percentage
    openTaskCount: number;
    overdueTaskCount: number;
    /** City-campaigns with status='completed' in the current scope. */
    citiesCompleted: number;
    /** Sum of campaigns.target_cities_scheduled in scope; defaults to 10. */
    citiesGoal: number;
  };
  /** The campaign currently scoping the dashboard, or null if 'all campaigns'. */
  scopedCampaign: {
    id: string;
    name: string;
  } | null;
}

export interface LoadDashboardOptions {
  /**
   * If provided, restrict the dashboard to this campaign's city_campaigns
   * only. The dashboard page resolves this from the current-campaign cookie
   * and passes it through. When null, shows every active city_campaign
   * across every active campaign (the "All campaigns" toggle).
   */
  campaignId: string | null;
  /**
   * The staff member viewing the dashboard. The "Upcoming tasks" widget
   * + the open/overdue task KPI counts are scoped to THIS person's
   * assigned tasks — operators flagged that task lists shouldn't be
   * visible to everyone (session 12). When omitted (legacy callers),
   * tasks fall back to the team-wide view.
   */
  viewerStaffId?: string;
}

export async function loadDashboardData(
  options: LoadDashboardOptions = { campaignId: null },
): Promise<DashboardData> {
  // ---- 1. Fetch active city_campaigns with city + campaign info ----
  // Scope to a single campaign by default (operator selected it in the
  // switcher); fall back to all-active if explicitly broadened.
  const campaignFilter = options.campaignId
    ? eq(cityCampaigns.campaignId, options.campaignId)
    : undefined;

  // Task scope — when a viewer is provided, restrict the upcoming-task
  // list + open/overdue counts to tasks assigned to them. Operators
  // flagged that the dashboard task list shouldn't expose everyone's
  // tasks (session 12). undefined viewer = team-wide (legacy).
  const viewerTaskFilter = options.viewerStaffId
    ? eq(tasks.assignedStaffId, options.viewerStaffId)
    : undefined;

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
      campaignCitiesGoal: campaigns.targetCitiesScheduled,
    })
    .from(cityCampaigns)
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .innerJoin(countries, eq(countries.code, cities.countryCode))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .where(and(isNull(cities.archivedAt), isNull(campaigns.archivedAt), campaignFilter))
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
            dayPart: events.dayPart,
            crawlNumber: events.crawlNumber,
            ticketSalesCount: events.ticketSalesCount,
            routeLabel: events.routeLabel,
            status: events.status,
            requiredVenueCountTotal: events.requiredVenueCountTotal,
            requiredWristbandCount: events.requiredWristbandCount,
            requiredMiddleCount: events.requiredMiddleCount,
            requiredFinalCount: events.requiredFinalCount,
          })
          .from(events)
          .where(and(isNull(events.archivedAt), inArray(events.cityCampaignId, cityCampaignIds)))
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
        // "Reply rate" = % of touchpoints where the venue actually engaged
        // back. The outreach_outcome enum doesn't have a generic "replied"
        // bucket, so we treat the engagement outcomes (interested,
        // confirmed, callback_requested, declined) as "got a response".
        // Declined still counts as engagement — they replied, just no.
        replyCount: sql<number>`count(*) filter (where outcome in ('interested','confirmed','callback_requested','declined'))::int`,
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
      dayPart: er.dayPart as EventRow["dayPart"],
      crawlNumber: er.crawlNumber,
      ticketSalesCount: er.ticketSalesCount ?? 0,
      routeLabel: er.routeLabel,
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
    const ticketsSold = ccEvents.reduce((sum, e) => sum + e.ticketSalesCount, 0);
    const campaignRow: CampaignRow = {
      cityCampaignId: cc.cityCampaignId,
      campaignName: cc.campaignName,
      campaignSlug: cc.campaignSlug,
      status: cc.status as CampaignRow["status"],
      salesCents: Number(cc.salesCents ?? 0),
      goalCents: Number(cc.goalCents ?? 0),
      ticketsSold,
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
        totalTicketsSold: 0,
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
    city.totalTicketsSold += campaignRow.ticketsSold;
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
  const totalTicketsSold = cityRows.reduce((sum, c) => sum + c.totalTicketsSold, 0);
  const totalGoalCents = cityRows.reduce((sum, c) => sum + c.totalGoalCents, 0);
  const replyRate =
    totalOutreachCount > 0 ? Math.round((replyCount / totalOutreachCount) * 100) : 0;

  // ---- 8. Tasks: upcoming (next 7d) + counts for KPIs ----
  // ---- 9. Recent notes feed (polymorphic target → display name) ----
  const [upcomingTaskRowsRaw, taskCountsResult, recentNotesRaw] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        dueAt: tasks.dueAt,
        assigneeName: staffMembers.displayName,
      })
      .from(tasks)
      .leftJoin(staffMembers, eq(staffMembers.id, tasks.assignedStaffId))
      .where(
        and(
          or(eq(tasks.status, "pending"), eq(tasks.status, "in_progress")),
          // Either has a due date in the next 7 days OR is overdue
          or(sql`${tasks.dueAt} < now() + interval '7 days'`, isNull(tasks.dueAt)),
          // Scope to the viewer's own tasks when a viewer is set.
          viewerTaskFilter,
        ),
      )
      .orderBy(sql`${tasks.dueAt} ASC NULLS LAST`, desc(tasks.createdAt))
      .limit(8),
    db
      .select({
        openTaskCount: sql<number>`count(*) filter (where status in ('pending','in_progress'))::int`,
        overdueTaskCount: sql<number>`count(*) filter (where status = 'pending' and due_at < now())::int`,
      })
      .from(tasks)
      .where(viewerTaskFilter),
    // Polymorphic notes feed: latest 10 notes joined with their target's
    // display name via LEFT JOINs gated by target_type. CASE chooses the
    // right name based on which target_type bucket the row belongs to.
    db.execute<{
      id: string;
      body: string;
      author_name: string;
      target_type: "venue" | "city_campaign" | "campaign";
      target_id: string;
      target_name: string | null;
      mention_count: number;
      created_at: Date;
    }>(sql`
      SELECT
        n.id,
        n.body,
        sm.display_name AS author_name,
        n.target_type::text AS target_type,
        n.target_id,
        CASE n.target_type
          WHEN 'venue' THEN v.name
          WHEN 'city_campaign' THEN c.name || ' · ' || cm.name
          WHEN 'campaign' THEN cm2.name
        END AS target_name,
        COALESCE(array_length(n.mentions, 1), 0) AS mention_count,
        n.created_at
      FROM notes n
      JOIN staff_members sm ON sm.id = n.author_staff_id
      LEFT JOIN venues v ON n.target_type = 'venue' AND v.id = n.target_id
      LEFT JOIN city_campaigns cc ON n.target_type = 'city_campaign' AND cc.id = n.target_id
      LEFT JOIN cities c ON c.id = cc.city_id
      LEFT JOIN campaigns cm ON cm.id = cc.campaign_id
      LEFT JOIN campaigns cm2 ON n.target_type = 'campaign' AND cm2.id = n.target_id
      ORDER BY n.created_at DESC
      LIMIT 10
    `),
  ]);
  const openTaskCount = Number(taskCountsResult[0]?.openTaskCount ?? 0);
  const overdueTaskCount = Number(taskCountsResult[0]?.overdueTaskCount ?? 0);

  const now = new Date();
  const upcomingTasks: UpcomingTaskRow[] = upcomingTaskRowsRaw.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    dueAt: t.dueAt,
    assigneeName: t.assigneeName,
    overdue: !!(t.dueAt && t.dueAt < now && t.status === "pending"),
  }));

  // db.execute returns either an array or { rows: [...] } depending on driver
  type RecentNoteRaw = {
    id: string;
    body: string;
    author_name: string;
    target_type: "venue" | "city_campaign" | "campaign";
    target_id: string;
    target_name: string | null;
    mention_count: number;
    created_at: Date;
  };
  const recentNotesList: RecentNoteRaw[] = Array.isArray(recentNotesRaw)
    ? (recentNotesRaw as unknown as RecentNoteRaw[])
    : ((recentNotesRaw as unknown as { rows: RecentNoteRaw[] }).rows ?? []);
  const recentNotes: RecentNoteRow[] = recentNotesList.map((n) => ({
    id: n.id,
    body: n.body,
    authorName: n.author_name,
    targetType: n.target_type,
    targetId: n.target_id,
    targetName: n.target_name ?? "(unknown target)",
    mentionCount: Number(n.mention_count ?? 0),
    createdAt: new Date(n.created_at),
  }));

  // Resolve the scoped campaign's name for the UI banner (avoids a second
  // round-trip from the page). Single SELECT by PK if we have an id.
  let scopedCampaign: DashboardData["scopedCampaign"] = null;
  if (options.campaignId) {
    const row = await db
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .where(eq(campaigns.id, options.campaignId))
      .limit(1);
    if (row[0]) scopedCampaign = { id: row[0].id, name: row[0].name };
  }

  // Cities completed + goal — for the dotted-arc KPI on the dashboard.
  // "Completed" here means the city-campaign has reached the final / sealed
  // state in the campaign workflow: confirmed OR contract_signed. (There's
  // no 'completed' value on city_campaign_status; the closest equivalent
  // is contract_signed, and most teams treat confirmed as "all crawls
  // locked" too — so we count both.) Goal lives on the campaign row
  // (targetCitiesScheduled); we sum across campaigns in scope. Falls back
  // to 10 when no goal has been set so the viz always renders.
  const COMPLETED_STATUSES = new Set(["confirmed", "contract_signed"]);
  const citiesCompleted = cityCampaignRows.filter((r) => COMPLETED_STATUSES.has(r.status)).length;
  const seenCampaigns = new Map<string, number>();
  for (const r of cityCampaignRows) {
    if (!seenCampaigns.has(r.campaignId)) {
      seenCampaigns.set(r.campaignId, r.campaignCitiesGoal ?? 0);
    }
  }
  let summedGoal = 0;
  for (const g of seenCampaigns.values()) summedGoal += g;
  const citiesGoal = summedGoal > 0 ? summedGoal : 10;

  return {
    cityRows,
    upcomingTasks,
    recentNotes,
    kpis: {
      venuesConfirmed: confirmedVenues,
      venuesTargeted,
      salesCents: totalSalesCents,
      goalCents: totalGoalCents,
      ticketsSold: totalTicketsSold,
      outreachThisWeek,
      outreachPrevWeek,
      eventsConfirmed: confirmedEvents,
      eventsPlanned: plannedEvents,
      replyRate,
      openTaskCount,
      overdueTaskCount,
      citiesCompleted,
      citiesGoal,
    },
    scopedCampaign,
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
