import "server-only";

/**
 * Event-day readiness summary (Phase 3.13 + P1-2 blocker). [ReferenceDoc 7.14.3]
 *
 * Thin server wrapper over the pure core (lib/event-readiness-core.ts) that adds
 * the single indexed DB read. The pure DTO + blocker logic live in the core so
 * they are unit-tested and client-importable; this module is the server-only
 * read path.
 */

import { events, cities, cityCampaigns, venueEvents, venues } from "@/db/schema";
import { db } from "@/lib/db";
import { type EventReadiness, readinessFromRow } from "@/lib/event-readiness-core";
import { and, asc, eq, sql } from "drizzle-orm";

export type {
  EventReadiness,
  ReadinessStatus,
  ReadinessStep,
  ReadinessStepKey,
  ReadinessRow,
} from "@/lib/event-readiness-core";
export {
  readinessFromRow,
  FLOOR_STAFF_ESCALATION_ATTEMPTS,
  READINESS_BLOCKER_WINDOW_DAYS,
} from "@/lib/event-readiness-core";

/** Read the venue_event row and compute its readiness DTO. Null when missing. */
export async function computeEventReadiness(venueEventId: string): Promise<EventReadiness | null> {
  const [row] = await db
    .select({
      venueEventId: venueEvents.id,
      confirmedAt: venueEvents.confirmedAt,
      twoWeekEmailSentAt: venueEvents.twoWeekEmailSentAt,
      oneWeekEmailSentAt: venueEvents.oneWeekEmailSentAt,
      threeDayCallCompletedAt: venueEvents.threeDayCallCompletedAt,
      floorStaffCallCompletedAt: venueEvents.floorStaffCallCompletedAt,
      floorStaffCallAttempts: venueEvents.floorStaffCallAttempts,
      // Days to event for the readiness blocker (P1-2). Negative = past.
      daysToEvent: sql<number | null>`(${events.eventDate} - now()::date)`,
    })
    .from(venueEvents)
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .where(eq(venueEvents.id, venueEventId))
    .limit(1);
  if (!row) return null;
  return readinessFromRow(row);
}

export interface ReadinessDashboardRow {
  venueEventId: string;
  venueId: string;
  venueName: string;
  cityName: string | null;
  eventDate: string;
  role: string;
  readiness: EventReadiness;
}

/**
 * Readiness dashboard (P1-2): every CONFIRMED venue_event for a campaign with
 * its event-day readiness DTO + blocker, soonest events first, blockers floated
 * to the top of their date bucket. Powers /readiness.
 */
export async function loadCampaignReadiness(opts: {
  campaignId: string;
}): Promise<ReadinessDashboardRow[]> {
  const rows = await db
    .select({
      venueEventId: venueEvents.id,
      venueId: venues.id,
      venueName: venues.name,
      cityName: cities.name,
      eventDate: events.eventDate,
      role: venueEvents.role,
      confirmedAt: venueEvents.confirmedAt,
      twoWeekEmailSentAt: venueEvents.twoWeekEmailSentAt,
      oneWeekEmailSentAt: venueEvents.oneWeekEmailSentAt,
      threeDayCallCompletedAt: venueEvents.threeDayCallCompletedAt,
      floorStaffCallCompletedAt: venueEvents.floorStaffCallCompletedAt,
      floorStaffCallAttempts: venueEvents.floorStaffCallAttempts,
      daysToEvent: sql<number | null>`(${events.eventDate} - now()::date)`,
    })
    .from(venueEvents)
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(and(eq(venueEvents.status, "confirmed"), eq(cityCampaigns.campaignId, opts.campaignId)))
    .orderBy(asc(events.eventDate));

  const mapped = rows.map((r) => ({
    venueEventId: r.venueEventId,
    venueId: r.venueId,
    venueName: r.venueName,
    cityName: r.cityName ?? null,
    eventDate: r.eventDate,
    role: r.role,
    readiness: readinessFromRow({
      venueEventId: r.venueEventId,
      confirmedAt: r.confirmedAt,
      twoWeekEmailSentAt: r.twoWeekEmailSentAt,
      oneWeekEmailSentAt: r.oneWeekEmailSentAt,
      threeDayCallCompletedAt: r.threeDayCallCompletedAt,
      floorStaffCallCompletedAt: r.floorStaffCallCompletedAt,
      floorStaffCallAttempts: r.floorStaffCallAttempts,
      daysToEvent: r.daysToEvent != null ? Number(r.daysToEvent) : null,
    }),
  }));
  mapped.sort((a, b) => {
    if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? -1 : 1;
    if (a.readiness.blocker !== b.readiness.blocker) return a.readiness.blocker ? -1 : 1;
    return a.venueName.localeCompare(b.venueName);
  });
  return mapped;
}
