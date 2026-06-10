import "server-only";

/**
 * Venue lifecycle board -- server read path. [CRM buildout, Phase 10]
 *
 * Loads the campaign's venue_events, resolves each one's readiness, maps it to a
 * kanban lane (lib/pipeline-board-core.ts) and groups them. Read-only v1: the
 * board shows where every venue sits in the pipeline and drills through to the
 * venue. (Drag-to-move with stage-gate enforcement is a follow-on.)
 */

import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  coldOutreachEntries,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { readinessFromRow } from "@/lib/event-readiness-core";
import {
  type Lane,
  type LaneKey,
  checkStageGate,
  groupByLane,
  venueEventToLane,
} from "@/lib/pipeline-board-core";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

export interface BoardCard {
  lane: LaneKey;
  venueEventId: string;
  venueId: string;
  venueName: string;
  cityName: string;
  role: string;
  status: string;
  eventDate: string;
  /** Server-formatted (UTC-pinned) short date, e.g. "Oct 31". */
  dateLabel: string;
  daysToEvent: number | null;
  /** Whether this card passes the Confirmed stage gate (contact + hours). */
  canConfirm: boolean;
  /** What's missing to confirm (empty when canConfirm). */
  confirmMissing: string[];
}

export interface LifecycleBoard {
  lanes: Lane<BoardCard>[];
  total: number;
  /** True when the fetch hit its cap (board shows the most-recently-updated). */
  truncated: boolean;
}

/** How many venue_events to pull. Bounds the payload on a large campaign; the
 *  board shows the most-recently-updated when this is exceeded. */
const FETCH_CAP = 1200;

/** "2026-10-31" -> "Oct 31" (UTC-pinned; the column is a plain date). */
function shortDate(eventDate: string): string {
  const d = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return eventDate;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export async function loadVenueLifecycleBoard(campaignId: string | null): Promise<LifecycleBoard> {
  const campaignFilter = campaignId ? eq(cityCampaigns.campaignId, campaignId) : undefined;

  const rows = await db
    .select({
      venueEventId: venueEvents.id,
      venueId: venues.id,
      venueName: venues.name,
      cityName: cities.name,
      role: venueEvents.role,
      status: venueEvents.status,
      eventDate: events.eventDate,
      // Toronto day, not UTC (UTC rolls at 8pm Toronto -> confirmed cards
      // would flip to "Completed" on event night before the crawl runs).
      daysToEvent: sql<
        number | null
      >`(${events.eventDate} - (now() at time zone 'America/Toronto')::date)`,
      // Stage-gate inputs (Phase 5): contact method + proposed hours.
      email: venues.email,
      phoneE164: venues.phoneE164,
      contactName: venues.contactName,
      slotStartTime: venueEvents.slotStartTime,
      agreedHoursText: venueEvents.agreedHoursText,
      nightOfContactName: venueEvents.nightOfContactName,
      nightOfContactPhone: venueEvents.nightOfContactPhoneE164,
      confirmedAt: venueEvents.confirmedAt,
      twoWeekEmailSentAt: venueEvents.twoWeekEmailSentAt,
      oneWeekEmailSentAt: venueEvents.oneWeekEmailSentAt,
      threeDayCallCompletedAt: venueEvents.threeDayCallCompletedAt,
      floorStaffCallCompletedAt: venueEvents.floorStaffCallCompletedAt,
      floorStaffCallAttempts: venueEvents.floorStaffCallAttempts,
    })
    .from(venueEvents)
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .where(and(isNull(events.archivedAt), isNull(campaigns.archivedAt), campaignFilter))
    .orderBy(desc(venueEvents.updatedAt))
    .limit(FETCH_CAP + 1);

  const truncated = rows.length > FETCH_CAP;
  const used = truncated ? rows.slice(0, FETCH_CAP) : rows;

  const cards: BoardCard[] = used.map((r) => {
    const daysToEvent = r.daysToEvent != null ? Number(r.daysToEvent) : null;
    const readiness = readinessFromRow({
      venueEventId: r.venueEventId,
      confirmedAt: r.confirmedAt,
      twoWeekEmailSentAt: r.twoWeekEmailSentAt,
      oneWeekEmailSentAt: r.oneWeekEmailSentAt,
      threeDayCallCompletedAt: r.threeDayCallCompletedAt,
      floorStaffCallCompletedAt: r.floorStaffCallCompletedAt,
      floorStaffCallAttempts: r.floorStaffCallAttempts,
      daysToEvent,
    });
    const lane = venueEventToLane({
      status: r.status,
      daysToEvent,
      readinessReady: readiness.status === "ready",
    });
    const hasContact = Boolean(
      r.email || r.phoneE164 || r.contactName || r.nightOfContactName || r.nightOfContactPhone,
    );
    const hasHours = Boolean(r.slotStartTime || r.agreedHoursText?.trim());
    const gate = checkStageGate("confirmed", { hasContact, hasHours });
    return {
      lane,
      venueEventId: r.venueEventId,
      venueId: r.venueId,
      venueName: r.venueName,
      cityName: r.cityName,
      role: r.role,
      status: r.status,
      eventDate: String(r.eventDate),
      dateLabel: shortDate(String(r.eventDate)),
      daysToEvent,
      canConfirm: gate.ok,
      confirmMissing: gate.missing,
    };
  });

  // Cold-outreach bridge (operator question 2026-06-10: "pipeline isn't
  // showing all venues emailed"): cold-emailed venues live in
  // cold_outreach_entries and have NO venue_event row until a slot is
  // offered, so the board never showed them. Surface them as read-only
  // cards -- email_sent/called/follow_up_due land in the Emailed lane,
  // interested in Warm Reply. Synthetic ids ("cold:<entryId>") are not
  // draggable (there is no venue_event to move).
  if (campaignId) {
    try {
      const coldRows = await db
        .select({
          entryId: coldOutreachEntries.id,
          status: coldOutreachEntries.status,
          venueId: venues.id,
          venueName: venues.name,
          cityName: cities.name,
        })
        .from(coldOutreachEntries)
        .innerJoin(venues, eq(venues.id, coldOutreachEntries.venueId))
        .innerJoin(cityCampaigns, eq(cityCampaigns.id, coldOutreachEntries.cityCampaignId))
        .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
        .where(
          and(
            eq(cityCampaigns.campaignId, campaignId),
            isNull(coldOutreachEntries.archivedAt),
            inArray(coldOutreachEntries.status, [
              "email_sent",
              "called",
              "follow_up_due",
              "interested",
            ]),
            sql`NOT EXISTS (
              SELECT 1 FROM venue_events ve
              JOIN events e ON e.id = ve.event_id
              JOIN city_campaigns cc2 ON cc2.id = e.city_campaign_id
              WHERE ve.venue_id = ${coldOutreachEntries.venueId}
                AND cc2.campaign_id = ${campaignId}
            )`,
          ),
        )
        .orderBy(desc(coldOutreachEntries.updatedAt))
        .limit(600);
      for (const r of coldRows) {
        cards.push({
          lane: r.status === "interested" ? "warm" : "contacted",
          venueEventId: `cold:${r.entryId}`,
          venueId: r.venueId,
          venueName: r.venueName,
          cityName: r.cityName,
          role: "cold",
          status: r.status,
          eventDate: "",
          dateLabel: "",
          daysToEvent: null,
          canConfirm: false,
          confirmMissing: [],
        });
      }
    } catch (err) {
      // Board still renders the venue_event cards if the bridge fails.
      console.error("pipeline cold-outreach bridge failed", err);
    }
  }

  return { lanes: groupByLane(cards), total: cards.length, truncated };
}
