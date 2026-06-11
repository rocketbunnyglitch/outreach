import "server-only";

/**
 * Unified contact roster for one venue (operator request 2026-06-11:
 * "more than one email or even more than one contact, sorted by the
 * latest replying contact... the entire system must all be linked").
 *
 * The engine already stores contact identity in four places — this
 * loader AGGREGATES them so the venue detail page shows one roster
 * instead of making the operator hunt:
 *
 *   1. venues.contact_name / email / alternate_emails / phone_e164
 *      (the on-file record; cold-table inline edits write here)
 *   2. Inbound email_messages on this venue's threads — the REAL
 *      humans who replied (name + address + when), newest first
 *   3. venue_events.night_of_contact_name/phone — per-slot night-of
 *      contacts entered on the crawl tables
 *
 * Read-only aggregation: no new table, no sync jobs to drift. Edits
 * keep flowing through the existing write paths (commitVenueEmails,
 * venue form, crawl slot table).
 *
 * Timestamps preformatted Toronto-pinned so the section renders as a
 * hydration-safe server component.
 */

import {
  events,
  cities,
  cityCampaigns,
  coldOutreachEntries,
  emailMessages,
  emailThreads,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "America/Toronto",
});

export interface ReplyingContact {
  name: string | null;
  email: string;
  /** Preformatted "Jun 10" — when they last wrote us. */
  lastReplyLabel: string;
  lastReplyAt: string;
  /** Already saved on the venue (primary or alternate)? */
  onFile: boolean;
}

export interface SlotContact {
  name: string | null;
  phone: string | null;
  /** "Fri, Oct 30" — which crawl night this contact covers. */
  eventLabel: string | null;
}

export interface OutreachRemark {
  text: string;
  cityName: string | null;
  /** "Jun 10" — when the remark was last edited. */
  updatedLabel: string;
}

export interface VenueContactsData {
  replying: ReplyingContact[];
  slotContacts: SlotContact[];
  /** Cold-table remarks for this venue (linkage-gap fix 2026-06-11:
   *  "call back Tuesday" used to live ONLY on the outreach table —
   *  invisible to anyone reading the venue page). Newest first. */
  remarks: OutreachRemark[];
}

const EMPTY: VenueContactsData = { replying: [], slotContacts: [], remarks: [] };

export async function loadVenueContacts(venueId: string): Promise<VenueContactsData> {
  try {
    const [venue] = await db
      .select({ email: venues.email, alternateEmails: venues.alternateEmails })
      .from(venues)
      .where(eq(venues.id, venueId))
      .limit(1);
    if (!venue) return EMPTY;

    const onFileSet = new Set(
      [venue.email, ...(venue.alternateEmails ?? [])]
        .filter((e): e is string => Boolean(e?.trim()))
        .map((e) => e.toLowerCase()),
    );

    // The humans who actually replied, newest reply first. Grouped by
    // address; the most recent from_name wins (people fix their display
    // names over time).
    const inbound = await db
      .select({
        email: emailMessages.fromEmailNormalized,
        name: emailMessages.fromName,
        sentAt: emailMessages.sentAt,
      })
      .from(emailMessages)
      .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
      .where(
        and(
          eq(emailThreads.venueId, venueId),
          eq(emailMessages.direction, "inbound"),
          isNotNull(emailMessages.fromEmailNormalized),
        ),
      )
      .orderBy(desc(emailMessages.sentAt))
      .limit(80);

    const replyingByEmail = new Map<string, ReplyingContact>();
    for (const m of inbound) {
      const key = (m.email ?? "").toLowerCase();
      if (!key || replyingByEmail.has(key)) continue;
      replyingByEmail.set(key, {
        name: m.name?.trim() || null,
        email: m.email ?? key,
        lastReplyLabel: TIME_FMT.format(m.sentAt),
        lastReplyAt: m.sentAt.toISOString(),
        onFile: onFileSet.has(key),
      });
      if (replyingByEmail.size >= 10) break;
    }

    // Night-of contacts from this venue's slots (crawl table entries).
    const slotRows = await db
      .select({
        name: venueEvents.nightOfContactName,
        phone: venueEvents.nightOfContactPhoneE164,
        eventDate: events.eventDate,
      })
      .from(venueEvents)
      .innerJoin(events, eq(events.id, venueEvents.eventId))
      .where(
        and(
          eq(venueEvents.venueId, venueId),
          or(
            isNotNull(venueEvents.nightOfContactName),
            isNotNull(venueEvents.nightOfContactPhoneE164),
          ),
          inArray(venueEvents.status, ["confirmed", "scheduled", "contract_signed"]),
          sql`${venueEvents.cancelledAt} IS NULL`,
        ),
      )
      .orderBy(desc(events.eventDate))
      .limit(12);

    const seenSlot = new Set<string>();
    const slotContacts: SlotContact[] = [];
    for (const r of slotRows) {
      const key = `${(r.name ?? "").toLowerCase()}|${r.phone ?? ""}`;
      if (seenSlot.has(key)) continue;
      seenSlot.add(key);
      slotContacts.push({
        name: r.name?.trim() || null,
        phone: r.phone ?? null,
        eventLabel: r.eventDate
          ? new Intl.DateTimeFormat("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }).format(new Date(`${String(r.eventDate)}T00:00:00Z`))
          : null,
      });
      if (slotContacts.length >= 6) break;
    }

    // Cold-table remarks across campaigns, newest first.
    const remarkRows = await db
      .select({
        remarks: coldOutreachEntries.remarks,
        updatedAt: coldOutreachEntries.updatedAt,
        cityName: cities.name,
      })
      .from(coldOutreachEntries)
      .innerJoin(cityCampaigns, eq(cityCampaigns.id, coldOutreachEntries.cityCampaignId))
      .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .where(
        and(
          eq(coldOutreachEntries.venueId, venueId),
          sql`COALESCE(TRIM(${coldOutreachEntries.remarks}), '') <> ''`,
        ),
      )
      .orderBy(desc(coldOutreachEntries.updatedAt))
      .limit(5);

    return {
      replying: [...replyingByEmail.values()],
      slotContacts,
      remarks: remarkRows.map((r) => ({
        text: (r.remarks ?? "").trim(),
        cityName: r.cityName ?? null,
        updatedLabel: TIME_FMT.format(r.updatedAt),
      })),
    };
  } catch (err) {
    logger.error({ err, venueId }, "loadVenueContacts failed");
    return EMPTY;
  }
}
