import "server-only";

/**
 * Glue between the confirmation cascade and the Phase 4 cascade-sends
 * queuer. Lives in its own file so the venue_event update action can
 * dynamic-import it (keeps the action's bundle slim when Phase 4
 * isn't active).
 *
 * Resolves the context queueCascadeSends needs:
 *   - venue.id + venue.email (recipient)
 *   - event.eventDate
 *   - city_campaign.outreach_brand_id (which brand sends the cascade)
 *   - brand.outreachPhase (gate at Phase 4)
 *   - staff member's connected inbox for that brand
 *
 * If any piece is missing (no email, no Phase 4 brand, no inbox), this
 * silently no-ops and the task-based cascade still covers the work.
 */

import {
  events,
  campaigns,
  cityCampaigns,
  outreachBrands,
  staffOutreachEmails,
  venueEvents,
  venues,
} from "@/db/schema";
import { queueCascadeSends } from "@/lib/cascade-sends";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";

export async function queueCascadeSendsForVenueEvent(opts: {
  venueEventId: string;
  staffMemberId: string;
}): Promise<{ queued: number; skipped: string[] }> {
  // Single big join to resolve everything
  const row = await db
    .select({
      venueId: venues.id,
      venueEmail: venues.email,
      eventDate: events.eventDate,
      outreachBrandId: campaigns.outreachBrandId,
      outreachPhase: outreachBrands.outreachPhase,
    })
    .from(venueEvents)
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .innerJoin(outreachBrands, eq(outreachBrands.id, campaigns.outreachBrandId))
    .where(eq(venueEvents.id, opts.venueEventId))
    .limit(1)
    .then((r) => r[0]);

  if (!row) return { queued: 0, skipped: ["venue_event lookup failed"] };
  if (!row.venueEmail) return { queued: 0, skipped: ["venue has no email"] };
  if (!row.outreachBrandId) return { queued: 0, skipped: ["city_campaign has no outreach brand"] };

  const phase = (row.outreachPhase as 1 | 2 | 3 | 4) ?? 1;
  if (phase < 4) return { queued: 0, skipped: [`brand at Phase ${phase}, not 4`] };

  // Resolve the staff member's connected inbox for this brand
  const inbox = await db
    .select({ id: staffOutreachEmails.id })
    .from(staffOutreachEmails)
    .where(
      and(
        eq(staffOutreachEmails.staffMemberId, opts.staffMemberId),
        eq(staffOutreachEmails.outreachBrandId, row.outreachBrandId),
        eq(staffOutreachEmails.status, "connected"),
      ),
    )
    .limit(1)
    .then((r) => r[0]);

  if (!inbox) {
    return { queued: 0, skipped: ["no connected inbox for this staff × brand"] };
  }

  // events.eventDate is a `date` column → comes back as string like '2026-10-31'
  const rawDate = row.eventDate as unknown;
  const eventDate = rawDate instanceof Date ? rawDate : new Date(`${rawDate as string}T00:00:00`);

  const result = await queueCascadeSends({
    venueId: row.venueId,
    venueEventId: opts.venueEventId,
    outreachBrandId: row.outreachBrandId,
    brandPhase: phase,
    eventDate,
    staffMemberId: opts.staffMemberId,
    staffOutreachEmailId: inbox.id,
    recipientEmail: row.venueEmail,
  });

  logger.info({ venueEventId: opts.venueEventId, result }, "cascade sends queued");
  return result;
}
