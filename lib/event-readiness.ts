import "server-only";

/**
 * Event-day readiness summary (Phase 3.13 + P1-2 blocker). [ReferenceDoc 7.14.3]
 *
 * Thin server wrapper over the pure core (lib/event-readiness-core.ts) that adds
 * the single indexed DB read. The pure DTO + blocker logic live in the core so
 * they are unit-tested and client-importable; this module is the server-only
 * read path.
 */

import { events, venueEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { type EventReadiness, readinessFromRow } from "@/lib/event-readiness-core";
import { eq, sql } from "drizzle-orm";

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
