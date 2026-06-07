import "server-only";

/**
 * Tracker dashboard status computation.
 *
 * Per-city status pill and the slot-need pills for a city_campaign.
 * Pulled in by the dashboard data loader.
 *
 * Slot model per crawl (EXACT, role-aware -- mirrors lib/crawl-matrix.ts):
 *   - Wristband venue: yellow pill; filled iff a confirmed
 *     role='wristband' venue_event exists.
 *   - Middle venue 1 / 2: orange pills; filled count = confirmed
 *     role='middle' venue_events (+ confirmed middle_venue_group_members
 *     when a group is attached), capped at required_middle_count.
 *   - Final venue: red pill; filled iff a confirmed role='final'
 *     venue_event exists. day_party crawls have NO final slot.
 *
 * A slot is "needed" when its role's confirmed-and-matching fill count is
 * below the crawl's required count for that role. This is computed PER
 * ROLE from the actual filled-by-role set, NOT from a raw confirmed
 * count assuming slots fill in order. Reused venues can't overcount
 * because each role's contribution is capped at its required count.
 *
 * "Confirmed" for slot-fill purposes = status in
 * (confirmed, scheduled, contract_signed) -- the same secured-slot set
 * crawl-matrix.ts uses. declined / cancelled venue_events do NOT fill a
 * slot.
 *
 * City-level status pill (priority order):
 *   - "cancelled": if city_campaign.status = 'cancelled'
 *   - "to_be_cancelled": city not cancelled, but EVERY crawl's own
 *     event status is 'cancelled' (operator flagged the whole city for
 *     teardown but has not cancelled the campaign row yet).
 *   - "need_3_venues": >= 3 exact slots open across all crawls
 *   - "need_2_venues": exactly 2 exact slots open
 *   - "need_1_venue": exactly 1 exact slot open
 *   - "complete": at least one crawl AND every required slot across all
 *     crawls filled by a confirmed matching-role venue.
 *   - "outreach": no open slots but not all confirmed (e.g. no crawls
 *     yet); engine in outreach mode.
 */

import { events, crawlHosts, venueEvents, wristbands } from "@/db/schema";
import { db } from "@/lib/db";
import { and, eq, inArray, sql } from "drizzle-orm";

/**
 * venue_event / group-member statuses that count as a slot actually
 * being SECURED. Mirrors CONFIRMED_STATUSES in lib/crawl-matrix.ts: a
 * signed contract or a scheduled date is as committed as "confirmed",
 * and treating them as unfilled would under-report readiness.
 */
const CONFIRMED_STATUSES = new Set(["confirmed", "scheduled", "contract_signed"]);
function isConfirmedStatus(s: string | null | undefined): boolean {
  return s != null && CONFIRMED_STATUSES.has(s);
}

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
    requiredWristbandCount: number;
    requiredMiddleCount: number;
    /** Crawl shape -- day_party crawls have NO final slot. */
    crawlFormat: string | null;
    /** Attached shared-middle template, if any. When set, confirmed
     *  group members count toward this crawl's middle fill. */
    middleVenueGroupId: string | null;
    venueEventStatus: string | null;
    venueRole: string | null;
    temporarilyDisabled: boolean | null;
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
        requiredWristbandCount: events.requiredWristbandCount,
        requiredMiddleCount: events.requiredMiddleCount,
        crawlFormat: events.crawlFormat,
        middleVenueGroupId: events.middleVenueGroupId,
        venueEventStatus: venueEvents.status,
        venueRole: venueEvents.role,
        temporarilyDisabled: venueEvents.temporarilyDisabled,
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
        requiredWristbandCount: events.requiredWristbandCount,
        requiredMiddleCount: events.requiredMiddleCount,
        crawlFormat: events.crawlFormat,
        middleVenueGroupId: events.middleVenueGroupId,
        venueEventStatus: venueEvents.status,
        venueRole: venueEvents.role,
        temporarilyDisabled: venueEvents.temporarilyDisabled,
        wristbandStatus: wristbands.status,
      })
      .from(events)
      .leftJoin(venueEvents, eq(venueEvents.eventId, events.id))
      .leftJoin(wristbands, eq(wristbands.venueEventId, venueEvents.id))
      .where(inArray(events.cityCampaignId, cityCampaignIds))) as Omit<EventJoinRow, "notes">[];
    rows = fallback.map((r) => ({ ...r, notes: null }));
  }

  // (Middle-group member counts are no longer fetched here: attached groups
  // copy their members into inline role='middle' venue_events, which are
  // already counted above -- see filledM below.)

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

  // Group by (city_campaign, day_part, crawl_number). Per-role confirmed
  // counts are tracked EXACTLY: a slot only counts as filled by a
  // venue_event of the MATCHING role whose status is in the confirmed
  // set. The main events query LEFT JOINs wristbands on
  // venue_events.id (a 1:1 unique relation), so each venue_event appears
  // exactly once per crawl -- no fan-out, so a straight per-role count
  // is correct.
  type CrawlBucket = {
    eventId: string;
    cityCampaignId: string;
    dayPart: string;
    crawlNumber: number;
    status: CrawlNeed["status"];
    ticketsSold: number;
    wristbandStatus: CrawlNeed["wristbandStatus"];
    notes: string;
    /** Per-event venue mix totals — pulled from the event row so the
     *  open-slot predicate respects day-party events (total=3,
     *  final=0). Migration 0074. */
    requiredVenueCountTotal: number;
    requiredFinalCount: number;
    requiredWristbandCount: number;
    requiredMiddleCount: number;
    isDayParty: boolean;
    middleVenueGroupId: string | null;
    /** Confirmed-and-matching venue_event counts, per role. */
    confirmedWristband: number;
    confirmedMiddle: number;
    confirmedFinal: number;
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
        ticketsSold: r.ticketsSold ?? 0,
        wristbandStatus: null,
        notes: r.notes ?? "",
        requiredVenueCountTotal: r.requiredVenueCountTotal ?? 4,
        requiredFinalCount: r.requiredFinalCount ?? 1,
        requiredWristbandCount: r.requiredWristbandCount ?? 1,
        requiredMiddleCount: r.requiredMiddleCount ?? 2,
        isDayParty: r.crawlFormat === "day_party",
        middleVenueGroupId: r.middleVenueGroupId ?? null,
        confirmedWristband: 0,
        confirmedMiddle: 0,
        confirmedFinal: 0,
      };
      buckets.set(k, b);
    }
    // Exact per-role slot fill: only confirmed-set statuses of the
    // MATCHING role count toward that role's fill. declined / cancelled
    // venue_events fall outside CONFIRMED_STATUSES so they never fill a
    // slot.
    // A temporarily_disabled venue_event (middle backed out, slot reopened)
    // keeps status='confirmed' but must NOT count as filling its slot.
    if (isConfirmedStatus(r.venueEventStatus) && !r.temporarilyDisabled) {
      if (r.venueRole === "wristband") b.confirmedWristband++;
      else if (r.venueRole === "middle") b.confirmedMiddle++;
      else if (r.venueRole === "final") b.confirmedFinal++;
    }
    // Capture the wristband-role venue's shipping status for this crawl.
    if (r.venueRole === "wristband" && r.wristbandStatus) {
      b.wristbandStatus = r.wristbandStatus;
    }
    // Tickets are per event, not per venue_event — only count once
    // (the join may dup; we take the first reasonable value).
    if (b.ticketsSold === 0 && r.ticketsSold) b.ticketsSold = r.ticketsSold;
  }

  // Per crawl: EXACT per-role missing slots, computed from the
  // confirmed-by-role counts captured above. NO order-preserving "tick
  // off as open shrinks" heuristic. Each role is evaluated against its
  // own required count independently:
  //
  //   missingWristband = max(0, requiredWristband - confirmedWristband)
  //   missingMiddle    = max(0, requiredMiddle    - middleFilled)
  //                        where middleFilled = confirmed role='middle'
  //                        venue_events + (group set ? confirmed group
  //                        members : 0), each capped at requiredMiddle.
  //   missingFinal     = day_party ? 0
  //                        : max(0, requiredFinal - confirmedFinal)
  //
  // Each role's contribution is capped at its required count so a venue
  // reused across roles/crawls can't drive a role negative or overcount.
  const byCC = new Map<string, CrawlNeed[]>();
  // Per-city exact missing-slot tally, kept alongside the crawl list so
  // the summary aggregates EXACT open slots (not just the count of true
  // need booleans, which collapses 3 missing middles into 1).
  const missingByCC = new Map<string, number>();
  // Track whether a city has any crawl at all, and whether every crawl's
  // own event status is 'cancelled' (drives to_be_cancelled).
  const crawlCountByCC = new Map<string, number>();
  const cancelledCrawlCountByCC = new Map<string, number>();

  for (const b of buckets.values()) {
    const reqW = Math.max(0, b.requiredWristbandCount);
    const reqM = Math.max(0, b.requiredMiddleCount);
    // day_party crawls have NO final slot regardless of required_final.
    const reqF = b.isDayParty ? 0 : Math.max(0, b.requiredFinalCount);

    // Cap each role's confirmed contribution at its required count.
    const filledW = Math.min(b.confirmedWristband, reqW);
    // Middle-group members are COPIED into inline role='middle' venue_events on
    // attach (copyGroupMembersIntoCrawl), so confirmedMiddle ALREADY counts
    // them -- adding the group members again double-counted (a partial group
    // could read as complete). Count the inline confirmed middles only.
    const filledM = Math.min(b.confirmedMiddle, reqM);
    const filledF = Math.min(b.confirmedFinal, reqF);

    const missingW = Math.max(0, reqW - filledW);
    const missingM = Math.max(0, reqM - filledM);
    const missingF = Math.max(0, reqF - filledF);

    const confirmedVenueCount = filledW + filledM + filledF;

    const need: CrawlNeed = {
      eventId: b.eventId,
      dayPart: b.dayPart,
      crawlNumber: b.crawlNumber,
      status: b.status,
      needsWristband: missingW > 0,
      // The need-bar exposes only two middle segments; map the exact
      // missing-middle count onto M1/M2 (>=1 missing lights M1, >=2
      // lights M2). The EXACT count flows into openSlotCount below so
      // a crawl needing 3 middles still tallies 3 open slots.
      needsMiddle1: missingM >= 1,
      needsMiddle2: missingM >= 2,
      needsFinal: missingF > 0,
      // hasFinalSlot lets the UI tell "filled" from "doesn't exist"
      // when needsFinal=false. Day crawls render only 3 segments;
      // standard crawls render 4.
      hasFinalSlot: reqF > 0,
      ticketsSold: b.ticketsSold,
      // Per-crawl sales is tickets × $30 (cents), mirroring the city-level
      // salesMap in tracker-data.ts. Will be replaced by a real Eventbrite
      // pull when the integration lands.
      salesCents: b.ticketsSold * 3000,
      wristbandStatus: b.wristbandStatus,
      hostType: hostTypeByEventId.get(b.eventId) ?? "none",
      notes: b.notes,
      outreachStarted: eventsWithOutreach.has(b.eventId) || confirmedVenueCount > 0,
      confirmedVenueCount,
    };
    const list = byCC.get(b.cityCampaignId) ?? [];
    list.push(need);
    byCC.set(b.cityCampaignId, list);

    crawlCountByCC.set(b.cityCampaignId, (crawlCountByCC.get(b.cityCampaignId) ?? 0) + 1);
    if (b.status === "cancelled") {
      cancelledCrawlCountByCC.set(
        b.cityCampaignId,
        (cancelledCrawlCountByCC.get(b.cityCampaignId) ?? 0) + 1,
      );
      // A cancelled crawl needs nothing -- don't let its empty slots
      // inflate the city's open-slot tally.
    } else {
      // EXACT open slots for this (active) crawl = sum of missing per role.
      missingByCC.set(
        b.cityCampaignId,
        (missingByCC.get(b.cityCampaignId) ?? 0) + missingW + missingM + missingF,
      );
    }
  }

  // Build summary per city_campaign
  const out = new Map<string, CityNeedSummary>();
  for (const cc of cityCampaignIds) {
    const crawls = byCC.get(cc) ?? [];
    // openSlotCount aggregates the EXACT missing slots across all crawls
    // (computed above), so 3 missing middles in one crawl + 1 missing
    // wristband in another reads as 4 open slots, not 2.
    const openSlotCount = missingByCC.get(cc) ?? 0;
    let needsWristband = false;
    let needsM1 = false;
    let needsM2 = false;
    let needsFinal = false;
    for (const c of crawls) {
      // A cancelled crawl needs nothing -- exclude its (stale) need
      // booleans from the city's aggregated slot pills.
      if (c.status === "cancelled") continue;
      if (c.needsWristband) needsWristband = true;
      if (c.needsMiddle1) needsM1 = true;
      if (c.needsMiddle2) needsM2 = true;
      if (c.needsFinal) needsFinal = true;
    }

    const slots: SlotKind[] = [];
    if (needsWristband) slots.push("wristband");
    if (needsM1 && needsM2) slots.push("middle_pair");
    else if (needsM1) slots.push("middle_1");
    else if (needsM2) slots.push("middle_2");
    if (needsFinal) slots.push("final");

    const crawlCount = crawlCountByCC.get(cc) ?? 0;
    const cancelledCrawls = cancelledCrawlCountByCC.get(cc) ?? 0;

    const ccStatus = cityCampaignStatusByID[cc];
    let statusPill: CityStatusPill;
    if (ccStatus === "cancelled") {
      statusPill = "cancelled";
    } else if (crawlCount > 0 && cancelledCrawls === crawlCount) {
      // Every crawl in the city is itself cancelled, but the
      // city_campaign row hasn't been hard-cancelled; flag for teardown.
      statusPill = "to_be_cancelled";
    } else if (openSlotCount === 0) {
      // No open slots. "complete" only when there's actually at least
      // one crawl whose slots are all filled; with zero crawls there's
      // nothing booked, so fall back to the outreach (engine-working)
      // state.
      statusPill = crawlCount > 0 ? "complete" : "outreach";
    } else if (openSlotCount === 1) {
      statusPill = "need_1_venue";
    } else if (openSlotCount === 2) {
      statusPill = "need_2_venues";
    } else {
      statusPill = "need_3_venues";
    }

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
