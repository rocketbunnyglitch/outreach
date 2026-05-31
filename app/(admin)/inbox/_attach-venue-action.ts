"use server";

/**
 * Inbox: attach a venue to an unassigned thread.
 *
 * The poll worker ingests every email — even ones whose sender domain
 * doesn't match a known venue. Those threads land with venue_id=null
 * and render as "Unassigned" in the inbox UI. This action lets the
 * operator pick a venue (via the search helper below) and stamp it
 * onto the thread retroactively.
 *
 * Two functions:
 *   searchVenuesForThread(query)
 *     Global venue search (not city-scoped — operator triages mail
 *     across the whole team). Returns up to 10 venues by ILIKE on
 *     name, with the city name attached for disambiguation.
 *
 *   attachVenueToThread(formData: { threadId, venueId })
 *     Validates ownership (thread is on the user's team) and writes
 *     email_threads.venue_id. revalidatePath so the page updates.
 */

import { cities, emailMessages, emailThreads, staffOutreachEmails, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, asc, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VenueSearchResult {
  id: string;
  name: string;
  cityName: string | null;
  address: string | null;
}

/**
 * Substring search across every venue the team can see. We do not
 * filter by team (venues aren't team-scoped in the current schema)
 * but we DO require an authenticated session.
 *
 * Caps at 10 results — the dropdown is meant for narrowing, not
 * browsing. Operators should type at least 2 chars.
 */
export async function searchVenuesForThread(query: string): Promise<VenueSearchResult[]> {
  await requireStaff();
  const q = query.trim();
  if (q.length < 2) return [];

  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      cityName: cities.name,
      address: venues.address,
    })
    .from(venues)
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(and(isNull(venues.archivedAt), ilike(venues.name, `%${q}%`)))
    .orderBy(asc(venues.name))
    .limit(10);
  return rows;
}

/**
 * Set email_threads.venue_id. Validates that:
 *   - the thread is on the user's team (via connected_accounts join)
 *   - the venue exists
 *
 * Does NOT attempt to also set city_campaign_id — that's a separate
 * choice (the campaign-matcher suggestion handles that one). Once a
 * venue is attached, on the next page render the matcher may upgrade
 * its confidence on a related campaign suggestion.
 */
export async function attachVenueToThread(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ threadId: string; venueId: string }>> {
  const { staff } = await requireStaff();
  const threadId = String(formData.get("threadId") ?? "");
  const venueId = String(formData.get("venueId") ?? "");
  if (!UUID_RE.test(threadId) || !UUID_RE.test(venueId)) {
    return { ok: false, error: "Invalid ids." };
  }

  const threadRow = await db
    .select({ teamId: staffOutreachEmails.teamId })
    .from(emailThreads)
    .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, emailThreads.staffOutreachEmailId))
    .where(eq(emailThreads.id, threadId))
    .limit(1);
  if (!threadRow[0] || threadRow[0].teamId !== staff.teamId) {
    return { ok: false, error: "Thread not found." };
  }

  const venueRow = await db
    .select({ id: venues.id })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);
  if (!venueRow[0]) return { ok: false, error: "Venue not found." };

  try {
    await db
      .update(emailThreads)
      .set({ venueId, updatedBy: staff.id })
      .where(eq(emailThreads.id, threadId));

    // Auto-learning: record this thread's primary inbound sender on
    // the venue's alternate_emails so future inbound mail from the
    // same address auto-matches via the cross-domain matcher in
    // lib/venue-communication. The poller's match-by-domain path
    // doesn't catch personal-Gmail senders from a venue's manager,
    // so manual linking is the canonical training signal.
    //
    // Best-effort: failure here doesn't roll back the thread link
    // (the link is the operator's primary intent; the alias is a
    // helpful side effect).
    try {
      const [latestInbound] = await db
        .select({ fromAddress: emailMessages.fromAddress })
        .from(emailMessages)
        .where(and(eq(emailMessages.threadId, threadId), eq(emailMessages.direction, "inbound")))
        .orderBy(desc(emailMessages.sentAt))
        .limit(1);
      const senderEmail = latestInbound?.fromAddress
        ? extractEmail(latestInbound.fromAddress)
        : null;
      if (senderEmail) {
        // Append only if not already in the array. The array_append +
        // ARRAY(SELECT DISTINCT ...) pattern keeps it idempotent at
        // the row level without a separate read-then-write race.
        await db.execute(sql`
          UPDATE venues
          SET alternate_emails = (
            SELECT ARRAY(SELECT DISTINCT e FROM unnest(
              array_append(alternate_emails, ${senderEmail})
            ) AS e WHERE e IS NOT NULL)
          )
          WHERE id = ${venueId}
            AND NOT (lower(${senderEmail}) = lower(coalesce(email, '')))
            AND NOT (lower(${senderEmail}) = ANY(
              SELECT lower(unnest(alternate_emails))
            ))
        `);
      }
    } catch (learnErr) {
      logger.warn({ learnErr, threadId, venueId }, "attachVenueToThread auto-learn failed");
    }

    revalidatePath(`/inbox/${threadId}`);
    revalidatePath("/inbox");
    revalidatePath(`/venues/${venueId}`);
    return { ok: true, data: { threadId, venueId } };
  } catch (err) {
    logger.error({ err, threadId, venueId }, "attachVenueToThread failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not attach venue.",
    };
  }
}

/**
 * Extract a bare lowercase email from a header value like
 *   "Mike Lavelle <mike@lavelle.com>"
 * Returns null if no email can be extracted.
 */
function extractEmail(headerVal: string): string | null {
  const m = headerVal.match(/<([^>]+)>/) ?? headerVal.match(/([\w.\-+]+@[\w.\-]+)/);
  return m?.[1]?.toLowerCase() ?? null;
}
