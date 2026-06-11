import "server-only";

/**
 * Post-confirm board -- server read path. [CRM buildout, Phase 10]
 *
 * Loads the campaign's CONFIRMED venue_events and the post-confirmation signals
 * (graphic deliverable, info sheet, lifecycle T13/T14 drafts, floor-staff call,
 * readiness), then assigns each to its outstanding-step lane. All typed Drizzle
 * -- no raw SQL. Note: email_drafts are venue + city_campaign scoped (not
 * venue_event scoped), so the T13/T14 "due" signal is matched on those.
 */

import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  crawlDeliverables,
  emailDrafts,
  staffInfoSheets,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { readinessFromRow } from "@/lib/event-readiness-core";
import {
  type PostConfirmColumn,
  type PostConfirmLane,
  assignPostConfirmLane,
  groupByPostConfirmLane,
} from "@/lib/post-confirm-board-core";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

export interface PostConfirmCard {
  lane: PostConfirmLane;
  venueEventId: string;
  venueId: string;
  venueName: string;
  cityName: string;
  role: string;
  eventDate: string;
  dateLabel: string;
  daysToEvent: number | null;
}

export interface PostConfirmBoard {
  columns: PostConfirmColumn<PostConfirmCard>[];
  total: number;
}

/** Days within the event for the floor-staff (V2) call window. */
const V2_WINDOW_DAYS = 4;

function shortDate(eventDate: string): string {
  const d = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return eventDate;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export async function loadPostConfirmBoard(campaignId: string | null): Promise<PostConfirmBoard> {
  const campaignFilter = campaignId ? eq(cityCampaigns.campaignId, campaignId) : undefined;

  const rows = await db
    .select({
      venueEventId: venueEvents.id,
      venueId: venues.id,
      venueName: venues.name,
      cityName: cities.name,
      cityCampaignId: cityCampaigns.id,
      role: venueEvents.role,
      eventDate: events.eventDate,
      daysToEvent: sql<number | null>`(${events.eventDate} - now()::date)`,
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
    .where(and(isNull(events.archivedAt), eq(venueEvents.status, "confirmed"), campaignFilter))
    // Soonest events first (most relevant); bound the payload on a broad scope.
    .orderBy(asc(events.eventDate))
    .limit(1500);

  if (rows.length === 0) {
    return { columns: groupByPostConfirmLane<PostConfirmCard>([]), total: 0 };
  }

  const veIds = rows.map((r) => r.venueEventId);
  const venueIds = Array.from(new Set(rows.map((r) => r.venueId)));
  const ccIds = Array.from(new Set(rows.map((r) => r.cityCampaignId)));

  const [graphicRows, sheetRows, draftRows] = await Promise.all([
    db
      .select({ venueEventId: crawlDeliverables.venueEventId })
      .from(crawlDeliverables)
      .where(
        and(
          inArray(crawlDeliverables.venueEventId, veIds),
          eq(crawlDeliverables.deliverableType, "social_media_graphics"),
          eq(crawlDeliverables.status, "pending"),
        ),
      ),
    db
      .select({ venueEventId: staffInfoSheets.venueEventId })
      .from(staffInfoSheets)
      .where(inArray(staffInfoSheets.venueEventId, veIds)),
    db
      .select({
        venueId: emailDrafts.venueId,
        cityCampaignId: emailDrafts.cityCampaignId,
        touchType: emailDrafts.touchType,
        scheduledFor: emailDrafts.scheduledFor,
      })
      .from(emailDrafts)
      .where(
        and(
          inArray(emailDrafts.venueId, venueIds),
          inArray(emailDrafts.cityCampaignId, ccIds),
          inArray(emailDrafts.touchType, ["T13", "T14"]),
          isNull(emailDrafts.sentAt),
          isNotNull(emailDrafts.scheduledFor),
        ),
      ),
  ]);

  const graphicPending = new Set(graphicRows.map((r) => r.venueEventId));
  const sheetExists = new Set(sheetRows.map((r) => r.venueEventId));

  // Drafts that are actually DUE (scheduled in the past), keyed venue:cc:touch.
  const now = Date.now();
  const dueDraft = new Set<string>();
  for (const d of draftRows) {
    if (!d.venueId || !d.cityCampaignId || !d.touchType || !d.scheduledFor) continue;
    if (d.scheduledFor.getTime() <= now) {
      dueDraft.add(`${d.venueId}:${d.cityCampaignId}:${d.touchType}`);
    }
  }

  const cards: PostConfirmCard[] = rows.map((r) => {
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
    const v2Due =
      r.floorStaffCallCompletedAt == null &&
      daysToEvent != null &&
      daysToEvent >= 0 &&
      daysToEvent <= V2_WINDOW_DAYS;
    const lane = assignPostConfirmLane({
      needsGraphic: graphicPending.has(r.venueEventId),
      needsSheet: !sheetExists.has(r.venueEventId),
      t13Due: dueDraft.has(`${r.venueId}:${r.cityCampaignId}:T13`),
      t14Due: dueDraft.has(`${r.venueId}:${r.cityCampaignId}:T14`),
      v2Due,
      isReady: readiness.status === "ready",
    });
    return {
      lane,
      venueEventId: r.venueEventId,
      venueId: r.venueId,
      venueName: r.venueName,
      cityName: r.cityName,
      role: r.role,
      eventDate: String(r.eventDate),
      dateLabel: shortDate(String(r.eventDate)),
      daysToEvent,
    };
  });

  return { columns: groupByPostConfirmLane(cards), total: cards.length };
}
