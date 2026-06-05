import "server-only";

/**
 * Cancelled venues for a campaign (Phase 4.7). Lists every venue_event the
 * cancellation flow marked cancelled, newest first, with who/when/why so an
 * operator can see what dropped and start replacement outreach. [ReferenceDoc 7.16]
 */

import { events, cities, cityCampaigns, staffMembers, venueEvents, venues } from "@/db/schema";
import { db } from "@/lib/db";
import { and, desc, eq } from "drizzle-orm";

export interface CancelledVenueRow {
  venueEventId: string;
  venueId: string;
  venueName: string;
  cityName: string | null;
  eventDate: string;
  role: string;
  cancelledAt: string | null;
  reason: string | null;
  cancelledByName: string | null;
}

export async function loadCancelledVenues(opts: {
  campaignId: string;
}): Promise<CancelledVenueRow[]> {
  const rows = await db
    .select({
      venueEventId: venueEvents.id,
      venueId: venueEvents.venueId,
      venueName: venues.name,
      cityName: cities.name,
      eventDate: events.eventDate,
      role: venueEvents.role,
      cancelledAt: venueEvents.cancelledAt,
      reason: venueEvents.cancellationReason,
      cancelledByName: staffMembers.displayName,
    })
    .from(venueEvents)
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .leftJoin(staffMembers, eq(staffMembers.id, venueEvents.cancelledBy))
    .where(and(eq(cityCampaigns.campaignId, opts.campaignId), eq(venueEvents.status, "cancelled")))
    .orderBy(desc(venueEvents.cancelledAt));

  return rows.map((r) => ({
    venueEventId: r.venueEventId,
    venueId: r.venueId,
    venueName: r.venueName,
    cityName: r.cityName ?? null,
    eventDate: r.eventDate,
    role: r.role,
    cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
    reason: r.reason,
    cancelledByName: r.cancelledByName ?? null,
  }));
}
