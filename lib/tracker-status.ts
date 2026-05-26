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

import { events, venueEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";

export type CityStatusPill =
  | "outreach"
  | "need_1_venue"
  | "need_2_venues"
  | "need_3_venues"
  | "cancelled";

export type SlotKind = "wristband" | "middle_pair" | "middle_1" | "middle_2" | "final";

export interface CityNeedSummary {
  cityCampaignId: string;
  statusPill: CityStatusPill;
  openSlotCount: number;
  /** Aggregated slot pills across all crawls for this city. */
  slots: SlotKind[];
  crawlBreakdown: CrawlNeed[];
}

export interface CrawlNeed {
  /** Composite key — same day_part + crawl_number identifies a crawl */
  dayPart: string;
  crawlNumber: number;
  needsWristband: boolean;
  needsMiddle1: boolean;
  needsMiddle2: boolean;
  needsFinal: boolean;
  /** Tickets sold for this specific crawl across its venue_events */
  ticketsSold: number;
  /** Sales total for this crawl */
  salesCents: number;
}

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
      ticketsSold: events.ticketSalesCount,
      venueEventStatus: venueEvents.status,
    })
    .from(events)
    .leftJoin(venueEvents, eq(venueEvents.eventId, events.id))
    .where(inArray(events.cityCampaignId, cityCampaignIds));

  // Group by (city_campaign, day_part, crawl_number)
  type CrawlBucket = {
    cityCampaignId: string;
    dayPart: string;
    crawlNumber: number;
    confirmedVenueCount: number;
    ticketsSold: number;
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
        cityCampaignId: r.cityCampaignId,
        dayPart,
        crawlNumber,
        confirmedVenueCount: 0,
        ticketsSold: r.ticketsSold ?? 0,
      };
      buckets.set(k, b);
    }
    if (r.venueEventStatus === "confirmed") b.confirmedVenueCount++;
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
      dayPart: b.dayPart,
      crawlNumber: b.crawlNumber,
      needsWristband: open >= 4,
      needsMiddle1: open >= 3,
      needsMiddle2: open >= 2,
      needsFinal: open >= 1,
      ticketsSold: b.ticketsSold,
      salesCents: 0, // wire from existing dashboard query if needed
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

export const STATUS_PILL_TONE: Record<CityStatusPill, string> = {
  // Outreach = quiet emerald, "done with venues, in outreach mode"
  outreach:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300",
  // Need 1/2/3 share the slot gradient family so the page reads as one system
  need_1_venue:
    "bg-amber-400/15 text-amber-800 ring-amber-400/30 dark:bg-amber-400/15 dark:text-amber-200",
  need_2_venues:
    "bg-orange-500/15 text-orange-800 ring-orange-500/30 dark:bg-orange-500/15 dark:text-orange-200",
  need_3_venues: "bg-red-500/15 text-red-800 ring-red-500/30 dark:bg-red-500/15 dark:text-red-300",
  cancelled: "bg-zinc-500/8 text-zinc-500 ring-zinc-500/15 line-through dark:text-zinc-500",
};

export const STATUS_PILL_LABEL: Record<CityStatusPill, string> = {
  outreach: "Outreach",
  need_1_venue: "Need 1 venue",
  need_2_venues: "Need 2 venues",
  need_3_venues: "Need 3+ venues",
  cancelled: "Cancelled",
};

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
export const SLOT_PILL_TONE: Record<SlotKind, string> = {
  wristband: "bg-amber-400 text-amber-950 shadow-sm shadow-amber-400/30",
  middle_1: "bg-orange-500 text-orange-50 shadow-sm shadow-orange-500/30",
  middle_2: "bg-orange-500 text-orange-50 shadow-sm shadow-orange-500/30",
  middle_pair: "bg-orange-500 text-orange-50 shadow-sm shadow-orange-500/30",
  final: "bg-red-500 text-red-50 shadow-sm shadow-red-500/30",
};

export const SLOT_PILL_LABEL: Record<SlotKind, string> = {
  wristband: "Wristband",
  middle_1: "Middle 1",
  middle_2: "Middle 2",
  middle_pair: "Middle 1 + 2",
  final: "Final",
};
