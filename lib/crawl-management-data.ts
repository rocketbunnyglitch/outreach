import "server-only";

/**
 * Crawl deliverables — loader for the /crawl-management page.
 *
 * Returns a city-grouped tree of every venue_event in the current
 * campaign with each deliverable's status + the linked wristband
 * row for wristband-role venues.
 *
 * The page is read-heavy + write-light (operators glance to see
 * pending work, occasionally flip a checkbox). One big tree query
 * with deliverables aggregated via FILTER clauses keeps the page
 * load to a single DB round-trip.
 */

import {
  events,
  cities,
  cityCampaigns,
  crawlDeliverables,
  staffMembers,
  tasks,
  venueEvents,
  venues,
  wristbands,
} from "@/db/schema";
import { GRAPHICS_TASK_TITLE_PREFIX } from "@/lib/confirmation-cascade";
import { db } from "@/lib/db";
import { and, asc, eq, inArray, isNull, like, sql } from "drizzle-orm";

export interface DeliverableState {
  /** Existing crawl_deliverables row id when present. null = row hasn't
   *  been created yet (default 'pending' on read). */
  id: string | null;
  status: "pending" | "done" | "n_a";
  notes: string | null;
  assignedStaffName: string | null;
  /** Hours this row has been sitting pending (CRM plan C2 rot chips).
   *  null when the row doesn't exist yet or isn't pending. */
  pendingAgeHours: number | null;
}

export interface CrawlMgmtVenueRow {
  venueEventId: string;
  venueId: string;
  venueName: string;
  /** wristband | middle | final | alt_final. The wristband
   *  deliverable column reads from the linked wristbands table
   *  instead of crawl_deliverables when role === 'wristband'. */
  role: "wristband" | "middle" | "final" | "alt_final" | null;
  /** Status snapshot of the wristband entry tied to this
   *  venue_event. Only relevant when role = 'wristband'. */
  wristbandStatus: "pending" | "ready_to_ship" | "shipped" | "delivered" | "issue" | null;
  deliverables: {
    social_media_graphics: DeliverableState;
    staff_sheet: DeliverableState;
    participant_poster: DeliverableState;
    wristbands: DeliverableState;
    week_of_confirmation: DeliverableState;
  };
}

export type CrawlDeliverableType =
  | "social_media_graphics"
  | "staff_sheet"
  | "participant_poster"
  | "wristbands"
  | "week_of_confirmation";

export const CRAWL_DELIVERABLE_TYPES: CrawlDeliverableType[] = [
  "social_media_graphics",
  "staff_sheet",
  "participant_poster",
  "wristbands",
  "week_of_confirmation",
];

export type PendingByType = Record<CrawlDeliverableType, number>;

function zeroPendingByType(): PendingByType {
  return {
    social_media_graphics: 0,
    staff_sheet: 0,
    participant_poster: 0,
    wristbands: 0,
    week_of_confirmation: 0,
  };
}

export interface CrawlMgmtCrawlRow {
  eventId: string;
  crawlDate: string;
  crawlNumber: number;
  dayPart: string | null;
  crawlName: string | null;
  crawlFormat: "standard" | "day_party";
  venues: CrawlMgmtVenueRow[];
}

export interface CrawlMgmtCity {
  cityCampaignId: string;
  cityName: string;
  cityRegion: string | null;
  priority: number;
  crawls: CrawlMgmtCrawlRow[];
  /** Sum of pending deliverables across all venues in all crawls in
   *  this city. Drives the city-row count badge. */
  pendingCount: number;
  /** Pending count broken out per deliverable type -- drives the
   *  per-type pending filters + progress on /crawl-management. */
  pendingByType: PendingByType;
}

const DEFAULT_STATE: DeliverableState = {
  id: null,
  status: "pending",
  notes: null,
  assignedStaffName: null,
  pendingAgeHours: null,
};

export async function loadCrawlManagement(opts: {
  campaignId: string;
}): Promise<CrawlMgmtCity[]> {
  // 1. Every cityCampaign in this campaign + city info.
  const ccRows = await db
    .select({
      cityCampaignId: cityCampaigns.id,
      cityName: cities.name,
      cityRegion: cities.region,
      priority: cityCampaigns.priority,
    })
    .from(cityCampaigns)
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .where(eq(cityCampaigns.campaignId, opts.campaignId))
    .orderBy(asc(cityCampaigns.priority), asc(cities.name));

  if (ccRows.length === 0) return [];

  const ccIds = ccRows.map((c) => c.cityCampaignId);

  // 2. Every event in those cityCampaigns (not archived).
  const eventRows = await db
    .select({
      id: events.id,
      cityCampaignId: events.cityCampaignId,
      crawlDate: events.eventDate,
      crawlNumber: events.crawlNumber,
      dayPart: events.dayPart,
      crawlName: events.crawlName,
      crawlFormat: events.crawlFormat,
    })
    .from(events)
    .where(and(inArray(events.cityCampaignId, ccIds), isNull(events.archivedAt)))
    .orderBy(asc(events.eventDate), asc(events.slotNumber));

  if (eventRows.length === 0) {
    return ccRows.map((c) => ({
      cityCampaignId: c.cityCampaignId,
      cityName: c.cityName,
      cityRegion: c.cityRegion,
      priority: c.priority,
      crawls: [],
      pendingCount: 0,
      pendingByType: zeroPendingByType(),
    }));
  }

  const eventIds = eventRows.map((e) => e.id);

  // 3. Every venue_event under those events + venue info.
  const veRows = await db
    .select({
      id: venueEvents.id,
      eventId: venueEvents.eventId,
      venueId: venues.id,
      venueName: venues.name,
      role: venueEvents.role,
    })
    .from(venueEvents)
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .where(inArray(venueEvents.eventId, eventIds))
    .orderBy(asc(venueEvents.role), asc(venues.name));

  if (veRows.length === 0) {
    // Events exist but no venues assigned yet — return cities with
    // empty crawls (still useful for "what needs venues").
    const byCcEmpty = new Map<string, CrawlMgmtCrawlRow[]>();
    for (const ev of eventRows) {
      const list = byCcEmpty.get(ev.cityCampaignId) ?? [];
      list.push({
        eventId: ev.id,
        crawlDate: String(ev.crawlDate),
        crawlNumber: ev.crawlNumber ?? 1,
        dayPart: ev.dayPart,
        crawlName: ev.crawlName,
        crawlFormat: ev.crawlFormat,
        venues: [],
      });
      byCcEmpty.set(ev.cityCampaignId, list);
    }
    return ccRows.map((c) => ({
      cityCampaignId: c.cityCampaignId,
      cityName: c.cityName,
      cityRegion: c.cityRegion,
      priority: c.priority,
      crawls: byCcEmpty.get(c.cityCampaignId) ?? [],
      pendingCount: 0,
      pendingByType: zeroPendingByType(),
    }));
  }

  const veIds = veRows.map((v) => v.id);

  // 4. Deliverables + wristbands in two parallel lookups.
  const [delivRows, wristbandRows] = await Promise.all([
    db
      .select({
        id: crawlDeliverables.id,
        venueEventId: crawlDeliverables.venueEventId,
        type: crawlDeliverables.deliverableType,
        status: crawlDeliverables.status,
        notes: crawlDeliverables.notes,
        assignedStaffId: crawlDeliverables.assignedStaffId,
        ageHours: sql<number>`(extract(epoch from (now() - ${crawlDeliverables.createdAt})) / 3600)::int`,
      })
      .from(crawlDeliverables)
      .where(inArray(crawlDeliverables.venueEventId, veIds)),
    db
      .select({
        venueEventId: wristbands.venueEventId,
        status: wristbands.status,
      })
      .from(wristbands)
      .where(inArray(wristbands.venueEventId, veIds)),
  ]);

  // Index deliverables by (venueEventId, type) for O(1) lookup.
  const delivByKey = new Map<string, (typeof delivRows)[number]>();
  for (const d of delivRows) {
    delivByKey.set(`${d.venueEventId}::${d.type}`, d);
  }
  const wristbandByVe = new Map<string, (typeof wristbandRows)[number]["status"]>();
  for (const w of wristbandRows) {
    wristbandByVe.set(w.venueEventId, w.status);
  }

  // 5. Stitch the tree. For each city, list its crawls, then each
  //    crawl's venues, then each venue's deliverables.
  const byCc = new Map<string, CrawlMgmtCrawlRow[]>();
  for (const ev of eventRows) {
    const venuesForEvent: CrawlMgmtVenueRow[] = veRows
      .filter((v) => v.eventId === ev.id)
      .map((v) => {
        const lookup = (type: string): DeliverableState => {
          const d = delivByKey.get(`${v.id}::${type}`);
          if (!d) return DEFAULT_STATE;
          return {
            id: d.id,
            status: d.status,
            notes: d.notes,
            assignedStaffName: null,
            pendingAgeHours: d.status === "pending" ? Number(d.ageHours) : null,
          };
        };
        const wristbandStatus = wristbandByVe.get(v.id) ?? null;
        return {
          venueEventId: v.id,
          venueId: v.venueId,
          venueName: v.venueName,
          role: v.role,
          wristbandStatus,
          deliverables: {
            social_media_graphics: lookup("social_media_graphics"),
            staff_sheet: lookup("staff_sheet"),
            participant_poster: lookup("participant_poster"),
            wristbands: lookup("wristbands"),
            week_of_confirmation: lookup("week_of_confirmation"),
          },
        };
      });
    const list = byCc.get(ev.cityCampaignId) ?? [];
    list.push({
      eventId: ev.id,
      crawlDate: String(ev.crawlDate),
      crawlNumber: ev.crawlNumber ?? 1,
      dayPart: ev.dayPart,
      crawlName: ev.crawlName,
      crawlFormat: ev.crawlFormat,
      venues: venuesForEvent,
    });
    byCc.set(ev.cityCampaignId, list);
  }

  return ccRows.map((c) => {
    const crawls = byCc.get(c.cityCampaignId) ?? [];
    let pendingCount = 0;
    const pendingByType = zeroPendingByType();
    for (const cr of crawls) {
      for (const v of cr.venues) {
        for (const [type, d] of Object.entries(v.deliverables)) {
          if (d.status === "pending") {
            pendingCount++;
            pendingByType[type as CrawlDeliverableType]++;
          }
        }
      }
    }
    return {
      cityCampaignId: c.cityCampaignId,
      cityName: c.cityName,
      cityRegion: c.cityRegion,
      priority: c.priority,
      crawls,
      pendingCount,
      pendingByType,
    };
  });
}

// =========================================================================
// Graphics queue (Graphics tab). The open list of social-media graphics that
// still need to be CREATED -- i.e. the auto graphics task (generated by the
// confirmation cascade, assigned to the graphics_designer) that isn't done
// yet. Once the designer marks it created (completes the task), it drops off
// this queue; the "sent" step is the social_media_graphics deliverable cell on
// the main tree (lifecycle owner flips it to done).
// =========================================================================

export interface GraphicsQueueRow {
  taskId: string;
  taskVersion: number;
  venueEventId: string;
  venueId: string;
  venueName: string;
  cityName: string | null;
  /** ISO date (YYYY-MM-DD) of the event. */
  eventDate: string;
  assigneeName: string | null;
  /** ISO timestamp the create task is due, or null. */
  dueAt: string | null;
}

export async function loadGraphicsQueue(opts: { campaignId: string }): Promise<GraphicsQueueRow[]> {
  const rows = await db
    .select({
      taskId: tasks.id,
      taskVersion: tasks.version,
      venueEventId: venueEvents.id,
      venueId: venues.id,
      venueName: venues.name,
      cityName: cities.name,
      eventDate: events.eventDate,
      assigneeName: staffMembers.displayName,
      dueAt: tasks.dueAt,
    })
    .from(tasks)
    .innerJoin(venueEvents, eq(venueEvents.id, tasks.targetId))
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .leftJoin(staffMembers, eq(staffMembers.id, tasks.assignedStaffId))
    .where(
      and(
        eq(tasks.source, "auto"),
        eq(tasks.targetType, "venue_event"),
        like(tasks.title, `${GRAPHICS_TASK_TITLE_PREFIX}%`),
        inArray(tasks.status, ["pending", "in_progress"]),
        eq(cityCampaigns.campaignId, opts.campaignId),
      ),
    )
    .orderBy(asc(events.eventDate));

  return rows.map((r) => ({
    taskId: r.taskId,
    taskVersion: r.taskVersion,
    venueEventId: r.venueEventId,
    venueId: r.venueId,
    venueName: r.venueName,
    cityName: r.cityName,
    eventDate: String(r.eventDate),
    assigneeName: r.assigneeName,
    dueAt: r.dueAt ? r.dueAt.toISOString() : null,
  }));
}
