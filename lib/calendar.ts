import "server-only";

/**
 * Calendar queries.
 *
 * The calendar shows tasks as time-anchored events. Each task with
 * due_at lands on a date+time; tasks without due_at don't appear (they
 * live in the Tasks page list instead).
 *
 * A calendar item carries the following extras beyond the tasks row:
 *   - venueName, cityName, campaignName (for venue / venue_event / city_campaign-targeted)
 *   - timezone (resolved from the target — same fallback chain as smart-notes)
 *   - itemType — classified for color-coding
 *   - source — manual / auto / smart_note (for the small icon)
 *
 * Two main entry points:
 *   - loadCalendarItems(opts) — for /calendar (one or more staff, any range)
 *   - loadCalendarItemsForTarget(opts) — for venue/city detail pages
 *
 * Returns items sorted by due_at ascending so consumers can group by
 * day cleanly.
 */

import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  staffMembers,
  tasks,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, asc, eq, gte, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";

export type CalendarItemType =
  | "call"
  | "follow_up_email"
  | "venue_callback"
  | "confirmation_reminder"
  | "poster_send"
  | "wristband_task"
  | "missing_info_task"
  | "reminder"
  | "venue_deadline"
  | "internal_meeting"
  | "custom";

export interface CalendarItem {
  id: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  source: "auto" | "manual" | "smart_note";
  targetType: "venue_event" | "venue" | "city_campaign" | "wristband" | "misc" | "email_thread";
  targetId: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  dueAt: Date;
  completedAt: Date | null;
  /** True when dueAt < now and not completed */
  overdue: boolean;

  // Resolved context
  venueId: string | null;
  venueName: string | null;
  cityId: string | null;
  cityName: string | null;
  cityCampaignId: string | null;
  campaignId: string | null;
  campaignName: string | null;

  /** IANA timezone the dueAt should be displayed in */
  timezone: string;

  /** Classified for color-coding */
  itemType: CalendarItemType;
}

interface LoadOpts {
  /** Filter to one staffer's tasks. Use null for everyone. */
  assignedStaffId: string | null;
  /** Inclusive start, exclusive end (UTC) */
  rangeStart: Date;
  rangeEnd: Date;
  /** Optional task-type filter (UI itemType) */
  itemTypes?: CalendarItemType[];
  /** Optional campaign filter */
  campaignId?: string | null;
  /** Optional city filter */
  cityId?: string | null;
  /** Optional status filter; default: exclude completed/cancelled */
  includeCompleted?: boolean;
}

/**
 * Pull every task with a due_at in the given range, joined to the
 * minimum venue+city+campaign context needed for display.
 *
 * Heavy joins live here. The Drizzle query is one statement so the
 * calendar UI never makes N+1 fetches.
 */
export async function loadCalendarItems(opts: LoadOpts): Promise<CalendarItem[]> {
  const {
    assignedStaffId,
    rangeStart,
    rangeEnd,
    itemTypes,
    campaignId,
    cityId,
    includeCompleted = false,
  } = opts;

  const rows = await db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      source: tasks.source,
      targetType: tasks.targetType,
      targetId: tasks.targetId,
      assignedStaffId: tasks.assignedStaffId,
      assignedStaffName: staffMembers.displayName,
      dueAt: tasks.dueAt,
      completedAt: tasks.completedAt,

      // venue → venue
      venueViaVenueId: venues.id,
      venueViaVenueName: venues.name,
      venueViaVenueCityId: venues.cityId,
      cityViaVenue: cities.id,
      cityViaVenueName: cities.name,
      cityViaVenueTimezone: cities.timezone,
    })
    .from(tasks)
    .leftJoin(staffMembers, eq(staffMembers.id, tasks.assignedStaffId))
    // Venue target: tasks.targetType='venue' AND tasks.targetId=venues.id
    .leftJoin(venues, and(eq(tasks.targetType, "venue"), eq(venues.id, tasks.targetId)))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(
      and(
        isNotNull(tasks.dueAt),
        gte(tasks.dueAt, rangeStart),
        lt(tasks.dueAt, rangeEnd),
        assignedStaffId ? eq(tasks.assignedStaffId, assignedStaffId) : undefined,
        includeCompleted
          ? undefined
          : and(ne(tasks.status, "completed"), ne(tasks.status, "cancelled")),
      ),
    )
    .orderBy(asc(tasks.dueAt));

  // Second pass for venue_event-targeted tasks. We need the venue + city
  // through venue_events.
  const venueEventTargetIds = rows
    .filter((r) => r.targetType === "venue_event" && r.targetId)
    .map((r) => r.targetId as string);

  const veRows =
    venueEventTargetIds.length === 0
      ? []
      : await db
          .select({
            venueEventId: venueEvents.id,
            venueId: venues.id,
            venueName: venues.name,
            cityId: cities.id,
            cityName: cities.name,
            cityTimezone: cities.timezone,
            eventCityCampaignId: events.cityCampaignId,
            campaignId: campaigns.id,
            campaignName: campaigns.name,
          })
          .from(venueEvents)
          .innerJoin(venues, eq(venues.id, venueEvents.venueId))
          .innerJoin(cities, eq(cities.id, venues.cityId))
          .innerJoin(events, eq(events.id, venueEvents.eventId))
          .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
          .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
          .where(inArray(venueEvents.id, venueEventTargetIds));

  const veById = new Map(veRows.map((v) => [v.venueEventId, v]));

  // Third pass: city_campaign targets
  const ccTargetIds = rows
    .filter((r) => r.targetType === "city_campaign" && r.targetId)
    .map((r) => r.targetId as string);

  const ccRows =
    ccTargetIds.length === 0
      ? []
      : await db
          .select({
            ccId: cityCampaigns.id,
            cityId: cities.id,
            cityName: cities.name,
            cityTimezone: cities.timezone,
            campaignId: campaigns.id,
            campaignName: campaigns.name,
          })
          .from(cityCampaigns)
          .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
          .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
          .where(inArray(cityCampaigns.id, ccTargetIds));

  const ccById = new Map(ccRows.map((c) => [c.ccId, c]));

  // For venue-targeted tasks we ALSO want the campaign context — look up
  // any city_campaign whose city matches. There can be multiple; we pick
  // the campaign that the scope filter targets if set, else first by name.
  const venueCityIds = new Set(
    rows
      .filter((r) => r.targetType === "venue" && r.cityViaVenue)
      .map((r) => r.cityViaVenue as string),
  );
  const venueCampaignsByCityId = new Map<
    string,
    { ccId: string; campaignId: string; campaignName: string }
  >();
  if (venueCityIds.size > 0) {
    const vcRows = await db
      .select({
        ccId: cityCampaigns.id,
        cityId: cityCampaigns.cityId,
        campaignId: campaigns.id,
        campaignName: campaigns.name,
      })
      .from(cityCampaigns)
      .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
      .where(inArray(cityCampaigns.cityId, Array.from(venueCityIds)));
    for (const r of vcRows) {
      if (!venueCampaignsByCityId.has(r.cityId)) {
        venueCampaignsByCityId.set(r.cityId, {
          ccId: r.ccId,
          campaignId: r.campaignId,
          campaignName: r.campaignName,
        });
      }
    }
  }

  const now = Date.now();
  const items: CalendarItem[] = rows
    .filter((r) => r.dueAt !== null)
    .map((r) => {
      const dueAt = r.dueAt as Date;
      let venueId: string | null = null;
      let venueName: string | null = null;
      let cityId: string | null = null;
      let cityName: string | null = null;
      let cityCampaignId: string | null = null;
      let runCampaignId: string | null = null;
      let runCampaignName: string | null = null;
      let timezone = "America/Toronto";

      if (r.targetType === "venue" && r.venueViaVenueId) {
        venueId = r.venueViaVenueId;
        venueName = r.venueViaVenueName;
        cityId = r.cityViaVenue;
        cityName = r.cityViaVenueName;
        timezone = r.cityViaVenueTimezone ?? timezone;
        if (cityId) {
          const vc = venueCampaignsByCityId.get(cityId);
          if (vc) {
            cityCampaignId = vc.ccId;
            runCampaignId = vc.campaignId;
            runCampaignName = vc.campaignName;
          }
        }
      } else if (r.targetType === "venue_event" && r.targetId) {
        const ve = veById.get(r.targetId);
        if (ve) {
          venueId = ve.venueId;
          venueName = ve.venueName;
          cityId = ve.cityId;
          cityName = ve.cityName;
          timezone = ve.cityTimezone;
          cityCampaignId = ve.eventCityCampaignId;
          runCampaignId = ve.campaignId;
          runCampaignName = ve.campaignName;
        }
      } else if (r.targetType === "city_campaign" && r.targetId) {
        const cc = ccById.get(r.targetId);
        if (cc) {
          cityId = cc.cityId;
          cityName = cc.cityName;
          timezone = cc.cityTimezone;
          cityCampaignId = r.targetId;
          runCampaignId = cc.campaignId;
          runCampaignName = cc.campaignName;
        }
      }

      const itemType = classifyTitle(r.title);

      return {
        id: r.taskId,
        title: r.title,
        description: r.description,
        status: r.status,
        source: r.source,
        targetType: r.targetType,
        targetId: r.targetId,
        assignedStaffId: r.assignedStaffId,
        assignedStaffName: r.assignedStaffName,
        dueAt,
        completedAt: r.completedAt,
        overdue: dueAt.getTime() < now && r.status !== "completed",
        venueId,
        venueName,
        cityId,
        cityName,
        cityCampaignId,
        campaignId: runCampaignId,
        campaignName: runCampaignName,
        timezone,
        itemType,
      };
    });

  // Post-filter: itemTypes, campaign, city
  return items.filter((item) => {
    if (itemTypes && itemTypes.length > 0 && !itemTypes.includes(item.itemType)) return false;
    if (campaignId && item.campaignId !== campaignId) return false;
    if (cityId && item.cityId !== cityId) return false;
    return true;
  });
}

/**
 * Classify a task title into an itemType for color-coding. Heuristic;
 * leans on the same patterns the smart-notes extractor uses.
 *
 * Confirmation cascade tasks (source=auto) have very predictable titles:
 *   "Deliver poster to <venue>"
 *   "2-week confirm with <venue>"
 *   "1-week confirm with <venue>"
 *   "Floor staff brief for <venue>"
 * Those get mapped to poster_send / confirmation_reminder / etc.
 */
function classifyTitle(title: string): CalendarItemType {
  const t = title.toLowerCase();
  if (t.includes("poster")) return "poster_send";
  if (t.includes("wristband") || t.includes("ship ")) return "wristband_task";
  if (t.includes("confirm")) return "confirmation_reminder";
  if (t.includes("callback") || t.includes("call back")) return "venue_callback";
  if (t.includes("follow up") || t.includes("follow-up") || t.includes("email")) {
    return "follow_up_email";
  }
  if (t.includes("missing ") || t.includes("need ")) return "missing_info_task";
  if (t.includes("reminder")) return "reminder";
  if (t.includes("meeting")) return "internal_meeting";
  if (t.startsWith("call") || t.includes(" call ")) return "call";
  return "custom";
}

/**
 * Venue or city-scoped variant — used on detail pages to render an
 * upcoming-tasks panel for that target. Pulls tasks that point at the
 * target directly OR (for cities) at any venue in the city.
 */
export async function loadCalendarItemsForTarget(opts: {
  target:
    | { type: "venue"; id: string }
    | { type: "city"; id: string }
    | { type: "city_campaign"; id: string };
  rangeStart: Date;
  rangeEnd: Date;
  includeCompleted?: boolean;
}): Promise<CalendarItem[]> {
  const { target, rangeStart, rangeEnd, includeCompleted = false } = opts;

  // For city scope, we need every venue in the city PLUS every
  // venue_event whose venue is in the city PLUS every city_campaign in
  // that city. Easiest: query tasks broadly then filter against the
  // resolved CalendarItem.cityId.
  if (target.type === "city") {
    const all = await loadCalendarItems({
      assignedStaffId: null,
      rangeStart,
      rangeEnd,
      includeCompleted,
    });
    return all.filter((i) => i.cityId === target.id);
  }

  if (target.type === "venue") {
    // Venue-targeted tasks OR venue_event-targeted where the venue matches
    const ves = await db
      .select({ id: venueEvents.id })
      .from(venueEvents)
      .where(eq(venueEvents.venueId, target.id));
    const veIds = ves.map((v) => v.id);

    const allConditions = or(
      and(eq(tasks.targetType, "venue"), eq(tasks.targetId, target.id)),
      veIds.length > 0
        ? and(eq(tasks.targetType, "venue_event"), inArray(tasks.targetId, veIds))
        : sql`false`,
    );

    const rangeOnly = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          isNotNull(tasks.dueAt),
          gte(tasks.dueAt, rangeStart),
          lt(tasks.dueAt, rangeEnd),
          allConditions,
          includeCompleted
            ? undefined
            : and(ne(tasks.status, "completed"), ne(tasks.status, "cancelled")),
        ),
      );
    const wanted = new Set(rangeOnly.map((r) => r.id));

    if (wanted.size === 0) return [];

    // Reuse the heavy loader and filter by id — keeps a single source of
    // truth for context resolution.
    const all = await loadCalendarItems({
      assignedStaffId: null,
      rangeStart,
      rangeEnd,
      includeCompleted,
    });
    return all.filter((i) => wanted.has(i.id));
  }

  // city_campaign target
  const all = await loadCalendarItems({
    assignedStaffId: null,
    rangeStart,
    rangeEnd,
    includeCompleted,
  });
  return all.filter((i) => i.cityCampaignId === target.id);
}
