"use server";

/**
 * Escalations dashboard loader — pulls the "currently escalated to me,
 * still pending" list for a given staff member.
 *
 * Used by the EscalationsWidget on the / dashboard so Brandon (or
 * whoever's a senior staffer) sees every venue waiting on him with
 * full context: venue, city, who escalated, when, the notes, contact
 * info, plus a deep link to the venue page.
 *
 * "Still pending" = the cold-outreach entry still has
 * escalated_to_staff_id set AND it's not in a terminal state
 * (do_not_contact, declined, confirmed, contract_signed). We don't
 * gate on the task's completed_at because the operator's mental
 * model is "is the escalation still parked with me?" — which lives
 * on the entry, not the task.
 *
 * Performance: indexed via cold_outreach_entries_escalated_to_idx
 * (partial index, migration 0027). One join to venues + cityCampaigns
 * + cities for the context. Cheap.
 */

import { cityCampaigns } from "@/db/schema/city-campaigns";
import { coldOutreachEntries } from "@/db/schema/cold-outreach";
import { cities } from "@/db/schema/geography";
import { staffMembers } from "@/db/schema/users";
import { venues } from "@/db/schema/venues";
import { db } from "@/lib/db";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export interface PendingEscalation {
  entryId: string;
  venueId: string;
  venueName: string;
  venuePhone: string | null;
  venueEmail: string | null;
  cityName: string;
  cityRegion: string | null;
  /** Display label e.g. "Toronto, ON" — pre-formatted server-side
   *  so the widget doesn't have to repeat the formatting logic. */
  cityLabel: string;
  /** ISO 8601 string for serialization across the server/client
   *  boundary. The widget formats relative time client-side. */
  escalatedAt: string;
  escalationNotes: string;
  escalatedByName: string | null;
  /** Current cold-outreach status — surfaces in the widget so
   *  the assignee knows whether to call now (interested),
   *  follow up softly (email_sent), or something else. */
  currentStatus: string;
}

/**
 * Pending escalations for the given staff id. Sorted by escalatedAt
 * descending — newest at top so a freshly-escalated venue is the
 * first thing the assignee sees on their dashboard.
 */
export async function loadPendingEscalationsForStaff(
  staffId: string,
): Promise<PendingEscalation[]> {
  // "Terminal" statuses — once the operator has marked one of these,
  // the escalation isn't actionable anymore even if the flag is still
  // set. We filter them out of the widget so it stays focused on TRUE
  // pending items.
  //
  // Limited to values that exist in the cold_outreach_status enum:
  //   do_not_contact — venue opted out
  //   declined       — venue said no
  //   unreachable    — auto-flipped after 5 unanswered call attempts
  //
  // Notably NOT in this list: bad_email + wrong_number — those CAN
  // be revived by adding a new email/phone and trying again, so the
  // escalation could still be acted on. Same for interested/called/
  // voicemail/etc. (active pipeline states).
  const TERMINAL_STATUSES: Array<"do_not_contact" | "declined" | "unreachable"> = [
    "do_not_contact",
    "declined",
    "unreachable",
  ];

  const escalator = alias(staffMembers, "escalator_staff");

  // The audit log records who set each field via the updated_by
  // column on cold_outreach_entries — that's the most recent
  // change. Since the escalation columns are set together, the
  // entry's updated_by at escalation time is the escalator's
  // staff id. We join on that to surface their displayName.
  const rows = await db
    .select({
      entryId: coldOutreachEntries.id,
      venueId: venues.id,
      venueName: venues.name,
      venuePhone: venues.phoneE164,
      venueEmail: venues.email,
      cityName: cities.name,
      cityRegion: cities.region,
      escalatedAt: coldOutreachEntries.escalatedAt,
      escalationNotes: coldOutreachEntries.escalationNotes,
      escalatedByName: escalator.displayName,
      currentStatus: coldOutreachEntries.status,
    })
    .from(coldOutreachEntries)
    .innerJoin(venues, eq(venues.id, coldOutreachEntries.venueId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, coldOutreachEntries.cityCampaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    // Join the escalator's staff record via the entry's updated_by.
    // LEFT JOIN — if the escalator's staff record is soft-deleted
    // we still show the escalation (with the name as null) rather
    // than dropping the row.
    .leftJoin(escalator, eq(escalator.id, coldOutreachEntries.updatedBy))
    .where(
      and(
        eq(coldOutreachEntries.escalatedToStaffId, staffId),
        notInArray(coldOutreachEntries.status, TERMINAL_STATUSES),
      ),
    )
    .orderBy(desc(coldOutreachEntries.escalatedAt));

  return rows.map((r) => ({
    entryId: r.entryId,
    venueId: r.venueId,
    venueName: r.venueName,
    venuePhone: r.venuePhone,
    venueEmail: r.venueEmail,
    cityName: r.cityName,
    cityRegion: r.cityRegion,
    cityLabel: r.cityRegion ? `${r.cityName}, ${r.cityRegion}` : r.cityName,
    escalatedAt: r.escalatedAt ? r.escalatedAt.toISOString() : new Date(0).toISOString(),
    escalationNotes: r.escalationNotes ?? "",
    escalatedByName: r.escalatedByName,
    currentStatus: r.currentStatus,
  }));
}
