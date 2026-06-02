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

import {
  cities,
  emailMessages,
  emailThreads,
  staffOutreachEmails,
  venueDomainAliases,
  venues,
} from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { extractEmailAddress } from "@/lib/email-address";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VenueSearchResult {
  id: string;
  name: string;
  cityName: string | null;
  address: string | null;
  /** When the row matched on a domain alias (not a name match), this
   *  carries the matching alias domain so the dropdown can show e.g.
   *  "Lavelle (matches alias: taohospitalitygroup.com)". Null when
   *  the row matched on venue name. */
  aliasMatch: string | null;
}

/**
 * Substring search across every venue the team can see. We do not
 * filter by team (venues aren't team-scoped in the current schema)
 * but we DO require an authenticated session.
 *
 * Matches in TWO axes (UNION):
 *   1. venues.name ILIKE %q% -- the obvious name match.
 *   2. venue_domain_aliases.domain ILIKE %q% -- so an operator
 *      looking at mike@taohospitalitygroup.com can type "tao" or
 *      "taohospitality" and find Lavelle (alias domain), even
 *      though Lavelle has no "tao" in its name.
 *
 * Name matches rank first (most common case + most predictable);
 * alias matches follow. Within each axis, ordered by venue name
 * ascending. The combined result is DISTINCT ON venue id so a
 * venue that matches both axes (rare: name AND alias both contain
 * the query) appears once.
 *
 * Caps at 10 results -- the dropdown is meant for narrowing, not
 * browsing.
 */
export async function searchVenuesForThread(query: string): Promise<VenueSearchResult[]> {
  await requireStaff();
  const q = query.trim();
  if (q.length < 2) return [];

  // Single query with a LEFT JOIN on aliases. We surface the
  // matched alias domain when the alias side fired the match.
  // Drizzle doesn't model "DISTINCT ON" well, so we just emit
  // every match and dedupe in JS afterwards -- the cap is 10
  // pre-dedupe (raised to 20 to leave headroom for collisions)
  // so the cost of dedupe in JS is negligible.
  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      cityName: cities.name,
      address: venues.address,
      // The aliased domain when this row's match came via the
      // alias side. Null when matched via the name side.
      aliasDomain: sql<
        string | null
      >`CASE WHEN ${venueDomainAliases.domain} IS NOT NULL AND ${venueDomainAliases.domain} ILIKE ${`%${q}%`} THEN ${venueDomainAliases.domain} ELSE NULL END`.as(
        "alias_domain",
      ),
      // Rank: 0 = name match, 1 = alias-only match. Used by ORDER BY
      // so name matches surface first.
      matchRank: sql<number>`CASE WHEN ${venues.name} ILIKE ${`%${q}%`} THEN 0 ELSE 1 END`.as(
        "match_rank",
      ),
    })
    .from(venues)
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .leftJoin(venueDomainAliases, eq(venueDomainAliases.venueId, venues.id))
    .where(
      and(
        isNull(venues.archivedAt),
        or(ilike(venues.name, `%${q}%`), ilike(venueDomainAliases.domain, `%${q}%`)),
      ),
    )
    .orderBy(asc(sql`match_rank`), asc(venues.name), desc(venueDomainAliases.createdAt))
    .limit(20);

  // Dedupe on venue id, keeping the first occurrence (name match
  // wins over alias match thanks to the ORDER BY).
  const seen = new Set<string>();
  const out: VenueSearchResult[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      name: r.name,
      cityName: r.cityName,
      address: r.address,
      aliasMatch: r.aliasDomain,
    });
    if (out.length >= 10) break;
  }
  return out;
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
): Promise<
  ActionResult<{
    threadId: string;
    venueId: string;
    /** How many OTHER unmatched threads on the same team were
     *  attached to this venue retroactively. UI shows a toast
     *  like "Attached to Lavelle (+3 more threads with the same
     *  sender)" so operators see the satisfying batch effect. */
    retroactivelyAttached: number;
  }>
> {
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

    // Count of OTHER unmatched threads we retroactively attached.
    // Declared at the outer-try scope so the success branch can
    // include it in the action result regardless of whether the
    // best-effort learn block succeeded. Defaults to 0 when learn
    // either didn't run (no inbound rows) or failed mid-flight.
    let retroactivelyAttached = 0;

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
    //
    // Retroactive linking: when the operator attaches the venue
    // via THIS thread, walk through OTHER currently-unmatched
    // threads with the same primary inbound sender (or any of the
    // sender's alternate addresses, if multiple inbounds exist)
    // and attach the venue to those too. The operator's intent
    // ("this email is Lavelle") logically applies to every other
    // email from the same person. Without this, the operator has
    // to attach the same venue dozens of times for one back-and-
    // forth correspondence that landed on multiple unmatched
    // threads.
    try {
      // Pull every inbound sender on this thread, not just the
      // latest. A venue's primary contact might use both
      // mike@lavelle.com AND mike@personal.com depending on the
      // device — attach should learn both.
      const inboundRows = await db
        .select({ fromAddress: emailMessages.fromAddress })
        .from(emailMessages)
        .where(and(eq(emailMessages.threadId, threadId), eq(emailMessages.direction, "inbound")));

      const inboundEmails = new Set<string>();
      for (const r of inboundRows) {
        if (r.fromAddress) {
          const e = extractEmail(r.fromAddress);
          if (e) inboundEmails.add(e);
        }
      }

      if (inboundEmails.size > 0) {
        const emailList = Array.from(inboundEmails);

        // Add each new sender address to venues.alternate_emails
        // (deduped, idempotent — see comment below).
        for (const senderEmail of emailList) {
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

        // Retroactive attach: find OTHER unmatched threads on the
        // same team whose normalized from-email matches any of
        // these senders. Scope to the team that owns the current
        // thread so a coincidental Gmail-side collision can't
        // cross-contaminate. Skip the current thread (already
        // attached above).
        const teamId = threadRow[0].teamId;
        const retroResult = await db.execute<{ id: string }>(sql`
          UPDATE email_threads et
          SET venue_id = ${venueId}, updated_by = ${staff.id}
          FROM staff_outreach_emails soe, email_messages em
          WHERE et.staff_outreach_email_id = soe.id
            AND soe.team_id = ${teamId}
            AND et.venue_id IS NULL
            AND et.id <> ${threadId}
            AND em.thread_id = et.id
            AND em.direction = 'inbound'
            AND em.from_email_normalized = ANY(${emailList})
          RETURNING et.id
        `);
        // drizzle.execute<T> returns a result whose shape varies by
        // driver. Normalize to count.
        const retroRows: Array<{ id: string }> = Array.isArray(retroResult)
          ? retroResult
          : ((retroResult as { rows?: Array<{ id: string }> }).rows ?? []);
        retroactivelyAttached = new Set(retroRows.map((r) => r.id)).size;
      }
    } catch (learnErr) {
      logger.warn({ learnErr, threadId, venueId }, "attachVenueToThread auto-learn failed");
    }

    revalidatePath(`/inbox/${threadId}`);
    revalidatePath("/inbox");
    revalidatePath(`/venues/${venueId}`);
    return {
      ok: true,
      data: { threadId, venueId, retroactivelyAttached },
    };
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
  // Delegates to the canonical parser in lib/email-address.ts.
  // Kept as a named local so existing call sites in this file
  // don't all need to be touched.
  return extractEmailAddress(headerVal);
}
