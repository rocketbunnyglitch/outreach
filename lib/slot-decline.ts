import "server-only";

/**
 * Templated polite-decline draft for a comeback whose slot is gone (Phase 4.8).
 * [ReferenceDoc 7.16.x comeback flow]
 *
 * When a cancelled venue replies wanting back in but their slot has since been
 * filled, the lead can't re-confirm. Instead of free-typing an awkward "sorry,
 * it's taken" each time, this builds a review draft (scheduledFor = null) with a
 * warm, on-brand decline that keeps the door open for future events.
 *
 * There is no seeded template_code for this (T16 is the PERSE-initiated
 * cancellation, which is a different situation), so the body is composed here
 * from the flat merge context (venue_name, contact_first_name, city,
 * signature_block) the rest of the engine uses. It mirrors T16's draft-build
 * shape: review draft owned by the operator, addressed to the venue email,
 * never auto-sent.
 */

import { events, cityCampaigns, emailDrafts, venueEvents, venues } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { buildFlatMergeContext } from "@/lib/template-merge-context";
import { renderTemplate } from "@/lib/template-render";
import { and, eq, isNull, ne } from "drizzle-orm";

const SUBJECT_TEMPLATE = "Update on the {{city}} crawl for {{venue_name}}";

// Warm, door-open polite decline. ASCII punctuation only. Collapses to a single
// short message: acknowledge the comeback, explain the slot filled, invite them
// to future events.
const BODY_TEMPLATE = `Hey {{contact_first_name}},

Thanks so much for getting back to us, and sorry for the delay! Unfortunately your slot for the {{city}} crawl has already been filled since we last spoke, so we are not able to fit {{venue_name}} in for this one.

We would genuinely love to work with you on a future crawl though. We run NYE, St. Patrick's, and next Halloween, and I will reach out to you first as those come up.

Thanks again, and sorry we could not make this one work.

{{signature_block}}`;

export interface PoliteDeclineResult {
  ok: boolean;
  draftId: string | null;
  error?: string;
}

/**
 * Build the polite-decline review draft for a comeback venue_event. Resolves the
 * venue + campaign context off the venue_event, renders the body via the flat
 * merge context, and inserts an unsent, unscheduled draft owned by byStaffId.
 */
export async function buildPoliteDeclineDraft(args: {
  venueEventId: string;
  byStaffId: string;
  teamId: string;
}): Promise<PoliteDeclineResult> {
  const [ve] = await db
    .select({
      venueId: venueEvents.venueId,
      eventId: venueEvents.eventId,
      venueEmail: venues.email,
      cityCampaignId: events.cityCampaignId,
      campaignId: cityCampaigns.campaignId,
    })
    .from(venueEvents)
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .where(eq(venueEvents.id, args.venueEventId))
    .limit(1);
  if (!ve) return { ok: false, draftId: null, error: "Venue event not found." };

  try {
    const ctx = await buildFlatMergeContext({
      venueId: ve.venueId,
      campaignId: ve.campaignId,
      cityCampaignId: ve.cityCampaignId,
      eventId: ve.eventId,
      staffId: args.byStaffId,
    });
    const [inserted] = await db
      .insert(emailDrafts)
      .values({
        ownerUserId: args.byStaffId,
        teamId: args.teamId,
        toAddresses: ve.venueEmail ? [ve.venueEmail] : [],
        subject: renderTemplate(SUBJECT_TEMPLATE, ctx).output,
        bodyText: renderTemplate(BODY_TEMPLATE, ctx).output,
        bodyHtml: null,
        venueId: ve.venueId,
        cityCampaignId: ve.cityCampaignId,
        templateId: null,
        scheduledFor: null,
      })
      .returning({ id: emailDrafts.id });
    return { ok: true, draftId: inserted?.id ?? null };
  } catch (err) {
    logger.error({ err, venueEventId: args.venueEventId }, "buildPoliteDeclineDraft failed");
    return { ok: false, draftId: null, error: "Couldn't build the decline draft." };
  }
}

/**
 * Slot-availability check for a comeback re-confirm. A slot is identified by
 * (event_id, role, slot_position). The comeback's own venue_event is cancelled
 * but still carries its old role/slot_position. The slot is AVAILABLE for the
 * comeback unless ANOTHER (different venue_event id) venue_event already holds
 * that exact (event_id, role, slot_position) in a live state (confirmed and not
 * temporarily disabled). Returns true when the venue can be re-confirmed.
 *
 * Conservative on ambiguity: if the comeback row is missing it returns false
 * (caller surfaces a polite decline rather than risk a double-book).
 */
export async function isComebackSlotAvailable(venueEventId: string): Promise<boolean> {
  const [self] = await db
    .select({
      eventId: venueEvents.eventId,
      role: venueEvents.role,
      slotPosition: venueEvents.slotPosition,
    })
    .from(venueEvents)
    .where(eq(venueEvents.id, venueEventId))
    .limit(1);
  if (!self) return false;

  // Any other live venue_event occupying the same slot makes it unavailable.
  const conflicts = await db
    .select({ id: venueEvents.id })
    .from(venueEvents)
    .where(
      and(
        eq(venueEvents.eventId, self.eventId),
        eq(venueEvents.role, self.role),
        self.slotPosition == null
          ? isNull(venueEvents.slotPosition)
          : eq(venueEvents.slotPosition, self.slotPosition),
        eq(venueEvents.status, "confirmed"),
        eq(venueEvents.temporarilyDisabled, false),
        ne(venueEvents.id, venueEventId),
      ),
    )
    .limit(1);
  return conflicts.length === 0;
}
