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

import { events, venueEvents, wristbands } from "@/db/schema";
import { db } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";

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

  // Load all events + venue_events for these city_campaigns
  const rows = await db
    .select({
      eventId: events.id,
      cityCampaignId: events.cityCampaignId,
      dayPart: events.dayPart,
      crawlNumber: events.crawlNumber,
      eventStatus: events.status,
      ticketsSold: events.ticketSalesCount,
      venueEventStatus: venueEvents.status,
      venueRole: venueEvents.role,
      wristbandStatus: wristbands.status,
    })
    .from(events)
    .leftJoin(venueEvents, eq(venueEvents.eventId, events.id))
    .leftJoin(wristbands, eq(wristbands.venueEventId, venueEvents.id))
    .where(inArray(events.cityCampaignId, cityCampaignIds));

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

  // Per crawl: 4 slots needed (wristband, middle 1, middle 2, final)
  // Confirmed count maps loosely — if confirmed >= 4 all filled.
  // Future: explicit slot positions.
  const SLOT_TARGET = 4;
  const byCC = new Map<string, CrawlNeed[]>();
  for (const b of buckets.values()) {
    const open = Math.max(0, SLOT_TARGET - b.confirmedVenueCount);
    // Simplified attribution: assume open slots fall in order
    // wristband → middle1 → middle2 → final
    const need: CrawlNeed = {
      eventId: b.eventId,
      dayPart: b.dayPart,
      crawlNumber: b.crawlNumber,
      status: b.status,
      needsWristband: open >= 4,
      needsMiddle1: open >= 3,
      needsMiddle2: open >= 2,
      needsFinal: open >= 1,
      ticketsSold: b.ticketsSold,
      salesCents: 0, // wire from existing dashboard query if needed
      wristbandStatus: b.wristbandStatus,
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
