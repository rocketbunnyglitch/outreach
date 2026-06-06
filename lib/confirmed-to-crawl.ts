import "server-only";

/**
 * confirmed-to-crawl -- bridge from an inbox "Confirmed" quick-action to the
 * crawl table.
 *
 * CLAUDE.md section 8 rule #5: "Never auto-confirm a VenueEvent from a parsed
 * email. Status flips to confirmed require a human click." This helper honors
 * that rule. When an operator clicks "Confirmed" on a venue-matched thread we do
 * NOT create a confirmed booking -- we create a venue_events row at
 * status='lead' so the venue surfaces in the crawl table as an unplaced lead.
 * The operator then re-slots it (picks role + slot_position) and only THEN flips
 * it to 'confirmed' through the venue-event editor, which is the human click the
 * rule requires.
 *
 * role='middle' is a PLACEHOLDER for an unplaced lead -- venue_events.role is
 * NOT NULL so we must pick something, and 'middle' is the only multi-slot role
 * (slot_position left NULL). The operator is expected to re-slot the lead (set
 * the real role + position) when they place it on the crawl. Treat the role as
 * "not yet placed", not as a real Middle assignment.
 */

import { events, emailThreads, venueEvents } from "@/db/schema";
import { db, withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, asc, eq, gte, sql } from "drizzle-orm";

export interface CreateCrawlLeadInput {
  threadId: string;
  /** Operator who clicked "Confirmed". Stamped as created_by / updated_by. */
  staffId: string;
  /** Operator's team. Reserved for future team-scoping of the lookup. */
  teamId: string;
}

export type CreateCrawlLeadResult =
  | { ok: true; venueEventId: string; alreadyExisted: boolean }
  | { ok: false; error: string };

/**
 * createCrawlLeadFromThread -- resolve the thread's venue + city_campaign, pick
 * the target event, and insert (or no-op on) a venue_events lead.
 *
 * Target-event selection: the earliest UPCOMING event for the thread's
 * city_campaign (event_date >= today, ordered by event_date). If the campaign
 * has no upcoming event (all dates in the past) we fall back to the earliest
 * event overall so the lead still lands somewhere the operator can find it.
 *
 * Idempotent: venue_events has UNIQUE(venue_id, event_id), so re-clicking
 * "Confirmed" hits onConflictDoNothing and we return the existing row's id with
 * alreadyExisted=true rather than erroring.
 */
export async function createCrawlLeadFromThread(
  input: CreateCrawlLeadInput,
): Promise<CreateCrawlLeadResult> {
  const { threadId, staffId } = input;

  // 1. Resolve the thread's venue + city_campaign. Both are required to place a
  //    lead on the crawl table -- a thread with no venue match or no campaign
  //    link has nowhere to go, so we return a clear, operator-readable error.
  const [thread] = await db
    .select({
      venueId: emailThreads.venueId,
      cityCampaignId: emailThreads.cityCampaignId,
    })
    .from(emailThreads)
    .where(eq(emailThreads.id, threadId))
    .limit(1);

  if (!thread) {
    return { ok: false, error: "Thread not found." };
  }
  if (!thread.venueId) {
    return {
      ok: false,
      error: "This thread isn't matched to a venue yet. Attach a venue first, then mark Confirmed.",
    };
  }
  if (!thread.cityCampaignId) {
    return {
      ok: false,
      error:
        "This thread isn't linked to a campaign yet. Assign a campaign first, then mark Confirmed.",
    };
  }
  const venueId = thread.venueId;
  const cityCampaignId = thread.cityCampaignId;

  // 2. Pick the target event: earliest UPCOMING event for the city_campaign.
  //    Postgres `date` compares correctly against CURRENT_DATE; today counts as
  //    upcoming (event_date >= today).
  const [upcoming] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.cityCampaignId, cityCampaignId), gte(events.eventDate, sql`CURRENT_DATE`)))
    .orderBy(asc(events.eventDate))
    .limit(1);

  let targetEventId = upcoming?.id ?? null;

  // Fallback: no upcoming event (all in the past) -> earliest event overall.
  if (!targetEventId) {
    const [earliest] = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.cityCampaignId, cityCampaignId))
      .orderBy(asc(events.eventDate))
      .limit(1);
    targetEventId = earliest?.id ?? null;
  }

  if (!targetEventId) {
    return {
      ok: false,
      error: "That campaign has no crawl nights set up yet. Create an event first.",
    };
  }
  const eventId = targetEventId;

  // 3. Insert the lead. Idempotent via UNIQUE(venue_id, event_id) ->
  //    onConflictDoNothing. role='middle' + slot_position=NULL is the unplaced-
  //    lead placeholder (see module doc); status='lead' keeps the human-confirm
  //    rule intact.
  try {
    const inserted = await withAuditContext(staffId, async (tx) =>
      tx
        .insert(venueEvents)
        .values({
          venueId,
          eventId,
          role: "middle",
          status: "lead",
          slotPosition: null,
          createdBy: staffId,
          updatedBy: staffId,
        })
        .onConflictDoNothing({ target: [venueEvents.venueId, venueEvents.eventId] })
        .returning({ id: venueEvents.id }),
    );

    if (inserted[0]) {
      return { ok: true, venueEventId: inserted[0].id, alreadyExisted: false };
    }

    // Conflict -> the lead already exists. Look it up so the caller still gets
    // an id and a friendly "already there" signal.
    const [existing] = await db
      .select({ id: venueEvents.id })
      .from(venueEvents)
      .where(and(eq(venueEvents.venueId, venueId), eq(venueEvents.eventId, eventId)))
      .limit(1);

    if (existing) {
      return { ok: true, venueEventId: existing.id, alreadyExisted: true };
    }

    // Should be unreachable (insert no-op'd but no row found). Surface clearly.
    return { ok: false, error: "This venue is already on the crawl for that night." };
  } catch (err) {
    logger.error({ err, threadId, venueId, eventId }, "createCrawlLeadFromThread insert failed");
    return { ok: false, error: "Couldn't add the venue to the crawl table." };
  }
}
