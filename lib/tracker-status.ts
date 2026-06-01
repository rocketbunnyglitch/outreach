import "server-only";

/**
 * Tracker dashboard status computation.
 *
 * Per-city status pill and the slot-need pills for a city_campaign.
 * Pulled in by the dashboard data loader.
 *
 * Slot model per crawl:
 *   - Wristband venue (1)  — yellow pill
 *   - Middle venue 1       — orange pill
 *   - Middle venue 2       — orange pill (combines with #1 if both needed)
 *   - Final venue          — red pill
 *
 * A slot is "needed" if no confirmed venue_event has the matching
 * crawl_position for that crawl_number/day_part. Operators can extend
 * by adding more middle/alt-final venues in the city sheet.
 *
 * City-level status pill (priority order):
 *   - "cancelled"        — if city_campaign.status = 'cancelled'
 *   - "need_3_venues"    — when >= 3 slots open across all crawls
 *   - "need_2_venues"    — exactly 2 slots open
 *   - "need_1_venue"     — exactly 1 slot open
 *   - "outreach"         — all slots filled (default; engine in outreach mode)
 */

import { events, crawlHosts, venueEvents, wristbands } from "@/db/schema";
import { db } from "@/lib/db";
import { and, eq, inArray, sql } from "drizzle-orm";

export type {
  CityStatusPill,
  SlotKind,
  CityNeedSummary,
  CrawlNeed,
} from "./tracker-status-types";
import type { CityNeedSummary, CityStatusPill, CrawlNeed, SlotKind } from "./tracker-status-types";
export {
  STATUS_PILL_TONE,
  STATUS_PILL_LABEL,
  SLOT_PILL_TONE,
  SLOT_PILL_LABEL,
} from "./tracker-status-types";

/**
 * Compute slot needs for a batch of city_campaigns at once. Single
 * query per table joined by city_campaign_id.
 *
 * Returns Map<cityCampaignId, CityNeedSummary>.
 *
 * For now we use a simplified slot detection: each event represents
 * one crawl slot. The venue_event with confirmed status fills it.
 * Future: explicit crawl_position column when we have it.
 */
export async function computeCityNeeds(
  cityCampaignIds: string[],
  cityCampaignStatusByID: Record<string, string>,
): Promise<Map<string, CityNeedSummary>> {
  if (cityCampaignIds.length === 0) return new Map();

  // Load all events + venue_events for these city_campaigns.
  // Wrapped in try/catch because events.notes was added in migration
  // 0039 — if a deploy lands before the migration runs, the select on a
  // non-existent column would crash the whole dashboard. Falling back
  // to an empty-notes view degrades gracefully (the rest of the
  // tracker still works; the per-crawl Notes column just stays blank
  // until the migration is applied).
  type EventJoinRow = {
    eventId: string;
    cityCampaignId: string;
    dayPart: string | null;
    crawlNumber: number | null;
    eventStatus: string | null;
    ticketsSold: number | null;
    notes: string | null;
    /** Per-event venue mix target. Drives the open-slot predicate so
     *  day-party events (total=3, final=0) don't get "needsFinal"
     *  forever. Migration 0074. */
    requiredVenueCountTotal: number;
    requiredFinalCount: number;
    venueEventStatus: string | null;
    venueRole: string | null;
    wristbandStatus: CrawlNeed["wristbandStatus"];
  };
  let rows: EventJoinRow[];
  try {
    rows = (await db
      .select({
        eventId: events.id,
        cityCampaignId: events.cityCampaignId,
        dayPart: events.dayPart,
        crawlNumber: events.crawlNumber,
        eventStatus: events.status,
        ticketsSold: events.ticketSalesCount,
        notes: events.notes,
        requiredVenueCountTotal: events.requiredVenueCountTotal,
        requiredFinalCount: events.requiredFinalCount,
        venueEventStatus: venueEvents.status,
        venueRole: venueEvents.role,
        wristbandStatus: wristbands.status,
      })
      .from(events)
      .leftJoin(venueEvents, eq(venueEvents.eventId, events.id))
      .leftJoin(wristbands, eq(wristbands.venueEventId, venueEvents.id))
      .where(inArray(events.cityCampaignId, cityCampaignIds))) as EventJoinRow[];
  } catch {
    const fallback = (await db
      .select({
        eventId: events.id,
        cityCampaignId: events.cityCampaignId,
        dayPart: events.dayPart,
        crawlNumber: events.crawlNumber,
        eventStatus: events.status,
        ticketsSold: events.ticketSalesCount,
        requiredVenueCountTotal: events.requiredVenueCountTotal,
        requiredFinalCount: events.requiredFinalCount,
        venueEventStatus: venueEvents.status,
        venueRole: venueEvents.role,
        wristbandStatus: wristbands.status,
      })
      .from(events)
      .leftJoin(venueEvents, eq(venueEvents.eventId, events.id))
      .leftJoin(wristbands, eq(wristbands.venueEventId, venueEvents.id))
      .where(inArray(events.cityCampaignId, cityCampaignIds))) as Omit<EventJoinRow, "notes">[];
    rows = fallback.map((r) => ({ ...r, notes: null }));
  }

  // Per-crawl host kind, sourced from crawl_hosts where slot=1. Done
  // as a separate small query rather than another LEFT JOIN on the
  // main events query — the main one already fans out across
  // venue_events, and joining crawl_hosts on top would duplicate
  // every row by an extra factor of 1-2. Keeping this separate keeps
  // the math right + the SQL fast.
  const eventIds = [...new Set(rows.map((r) => r.eventId))];
  const hostTypeByEventId = new Map<string, "internal" | "external">();
  if (eventIds.length > 0) {
    try {
      const hostRows = await db
        .select({
          eventId: crawlHosts.eventId,
          hostType: crawlHosts.hostType,
        })
        .from(crawlHosts)
        .where(and(inArray(crawlHosts.eventId, eventIds), eq(crawlHosts.slot, 1)));
      for (const h of hostRows) {
        if (h.hostType === "internal" || h.hostType === "external") {
          hostTypeByEventId.set(h.eventId, h.hostType);
        }
      }
    } catch (err) {
      // Don't fail the whole dashboard if the host lookup hiccups —
      // just render every crawl as "no host needed" until the next
      // refresh succeeds.
      console.warn("[tracker-status] crawl_hosts lookup failed", err);
    }
  }

  // Outreach-started signal per event. Drives the dashboard glow
  // visualization's "grey vs red" distinction:
  //
  //   grey = no cold outreach sent AND no venues confirmed
  //   red  = cold outreach sent OR at least one venue assigned, but 0 booked
  //
  // We treat ANY email_send_event tied to a venue in this event's
  // city_campaign as "outreach started for any crawl in that city."
  // This is a slight over-attribution (the actual send is venue-
  // scoped, not crawl-scoped) but matches operator mental model —
  // they treat outreach as a city-wide push that lights up every
  // crawl on that night. Refining to per-event requires a venue ->
  // event join that's not worth the cost for v1.
  //
  // Wrapped in try/catch so a missing email_send_events table (test
  // env, pre-migration deploys) degrades to "no signal" instead of
  // 500-ing the tracker.
  const eventsWithOutreach = new Set<string>();
  try {
    if (rows.length > 0) {
      const eventIds = Array.from(new Set(rows.map((r) => r.eventId)));
      // Use IN (...) with sql.join + per-id ::uuid casts. Passing the
      // JS array straight into = ANY(${eventIds}) made the pg driver
      // serialize it as a comma-separated string, and Postgres threw
      // 42809 "op ANY/ALL (array) requires array on right side" —
      // which crashed the dashboard's tracker-status load every render
      // and visibly froze the / page.
      const sendRows = (await db.execute<{ event_id: string }>(sql`
        SELECT DISTINCT e.id AS event_id
        FROM events e
        INNER JOIN venue_events ve ON ve.event_id = e.id
        INNER JOIN email_threads et ON et.venue_id = ve.venue_id
        INNER JOIN email_send_events ese ON ese.thread_id = et.id
        WHERE e.id IN (${sql.join(
          eventIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
          AND ese.category = 'cold'
      `)) as unknown;
      const list: Array<{ event_id: string }> = Array.isArray(sendRows)
        ? (sendRows as Array<{ event_id: string }>)
        : ((sendRows as { rows: Array<{ event_id: string }> }).rows ?? []);
      for (const r of list) eventsWithOutreach.add(r.event_id);
    }
  } catch (err) {
    console.warn("[tracker-status] outreach-started lookup failed", err);
  }

  // Group by (city_campaign, day_part, crawl_number)
  type CrawlBucket = {
    eventId: string;
    cityCampaignId: string;
    dayPart: string;
    crawlNumber: number;
    status: CrawlNeed["status"];
    confirmedVenueCount: number;
    ticketsSold: number;
    wristbandStatus: CrawlNeed["wristbandStatus"];
    notes: string;
    /** Per-event venue mix totals — pulled from the event row so the
     *  open-slot predicate respects day-party events (total=3,
     *  final=0). Migration 0074. */
    requiredVenueCountTotal: number;
    requiredFinalCount: number;
  };
  const bucketKey = (cc: string, d: string, n: number) => `${cc}::${d}::${n}`;
  const buckets = new Map<string, CrawlBucket>();
  for (const r of rows) {
    const dayPart = (r.dayPart as string | null) ?? "saturday_night";
    const crawlNumber = r.crawlNumber ?? 1;
    const k = bucketKey(r.cityCampaignId, dayPart, crawlNumber);
    let b = buckets.get(k);
    if (!b) {
      b = {
        eventId: r.eventId,
        cityCampaignId: r.cityCampaignId,
        dayPart,
        crawlNumber,
        status: (r.eventStatus as CrawlNeed["status"]) ?? "planned",
        confirmedVenueCount: 0,
        ticketsSold: r.ticketsSold ?? 0,
        wristbandStatus: null,
        notes: r.notes ?? "",
        requiredVenueCountTotal: r.requiredVenueCountTotal ?? 4,
        requiredFinalCount: r.requiredFinalCount ?? 1,
      };
      buckets.set(k, b);
    }
    if (r.venueEventStatus === "confirmed") b.confirmedVenueCount++;
    // Capture the wristband-role venue's shipping status for this crawl.
    if (r.venueRole === "wristband" && r.wristbandStatus) {
      b.wristbandStatus = r.wristbandStatus;
    }
    // Tickets are per event, not per venue_event — only count once
    // (the join may dup; we take the first reasonable value).
    if (b.ticketsSold === 0 && r.ticketsSold) b.ticketsSold = r.ticketsSold;
  }

  // Per crawl: number of open slots = required_venue_count_total -
  // confirmed. The slot ATTRIBUTION (wristband / middle1 / middle2 /
  // final) is order-preserving: as open shrinks we tick off in the
  // order wristband → middle1 → middle2 → final. Day-party events
  // ship with required_final_count = 0, so needsFinal is suppressed
  // regardless of open count (their venue mix has no final slot).
  const byCC = new Map<string, CrawlNeed[]>();
  for (const b of buckets.values()) {
    const slotTarget = b.requiredVenueCountTotal;
    const open = Math.max(0, slotTarget - b.confirmedVenueCount);
    const noFinalSlot = b.requiredFinalCount === 0;
    const need: CrawlNeed = {
      eventId: b.eventId,
      dayPart: b.dayPart,
      crawlNumber: b.crawlNumber,
      status: b.status,
      // Day party (no final slot): we tick off in order wristband ->
      // middle1 -> middle2 with target = 3.
      // Standard: wristband -> middle1 -> middle2 -> final with target = 4.
      needsWristband: open >= slotTarget,
      needsMiddle1: open >= slotTarget - 1,
      needsMiddle2: open >= slotTarget - 2,
      needsFinal: noFinalSlot ? false : open >= 1,
      // hasFinalSlot lets the UI tell "filled" from "doesn't exist"
      // when needsFinal=false. Day crawls render only 3 segments;
      // standard crawls render 4.
      hasFinalSlot: !noFinalSlot,
      ticketsSold: b.ticketsSold,
      // Per-crawl sales is tickets × $30 (cents), mirroring the city-level
      // salesMap in tracker-data.ts. Will be replaced by a real Eventbrite
      // pull when the integration lands.
      salesCents: b.ticketsSold * 3000,
      wristbandStatus: b.wristbandStatus,
      hostType: hostTypeByEventId.get(b.eventId) ?? "none",
      notes: b.notes,
      outreachStarted: eventsWithOutreach.has(b.eventId) || b.confirmedVenueCount > 0,
      confirmedVenueCount: b.confirmedVenueCount,
    };
    const list = byCC.get(b.cityCampaignId) ?? [];
    list.push(need);
    byCC.set(b.cityCampaignId, list);
  }

  // Build summary per city_campaign
  const out = new Map<string, CityNeedSummary>();
  for (const cc of cityCampaignIds) {
    const crawls = byCC.get(cc) ?? [];
    let openSlotCount = 0;
    let needsWristband = false;
    let needsM1 = false;
    let needsM2 = false;
    let needsFinal = false;
    for (const c of crawls) {
      if (c.needsWristband) {
        needsWristband = true;
        openSlotCount++;
      }
      if (c.needsMiddle1) {
        needsM1 = true;
        openSlotCount++;
      }
      if (c.needsMiddle2) {
        needsM2 = true;
        openSlotCount++;
      }
      if (c.needsFinal) {
        needsFinal = true;
        openSlotCount++;
      }
    }

    const slots: SlotKind[] = [];
    if (needsWristband) slots.push("wristband");
    if (needsM1 && needsM2) slots.push("middle_pair");
    else if (needsM1) slots.push("middle_1");
    else if (needsM2) slots.push("middle_2");
    if (needsFinal) slots.push("final");

    const ccStatus = cityCampaignStatusByID[cc];
    let statusPill: CityStatusPill;
    if (ccStatus === "cancelled") statusPill = "cancelled";
    else if (openSlotCount === 0) statusPill = "outreach";
    else if (openSlotCount === 1) statusPill = "need_1_venue";
    else if (openSlotCount === 2) statusPill = "need_2_venues";
    else statusPill = "need_3_venues";

    out.set(cc, {
      cityCampaignId: cc,
      statusPill,
      openSlotCount,
      slots,
      crawlBreakdown: crawls.sort(
        (a, b) => a.dayPart.localeCompare(b.dayPart) || a.crawlNumber - b.crawlNumber,
      ),
    });
  }
  return out;
}

/**
 * Slot pills — tuned amber-400 → orange-500 → red-500 so when all three
 * line up they read as ONE continuous gradient bar, not three stickers.
 *
 * Tone math:
 *   amber-400  #fbbf24  H≈45°
 *   orange-500 #f97316  H≈25°
 *   red-500    #ef4444  H≈0°
 * Each step is ≈20° hue rotation with matched saturation/luminance, so
 * the perceptual jump from one pill to the next is uniform. Visually
 * the pills feel like a single chip with bands.
 *
 * middle_pair is a single 2x-wide pill so two open middles compress to
 * one chip instead of two adjacent orange chips that would break the
 * gradient rhythm.
 */
