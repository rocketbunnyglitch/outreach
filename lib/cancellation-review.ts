import "server-only";

/**
 * Cancellation-review queue (Phase 6.1). [ReferenceDoc 7.9]
 *
 * Mid event-week (Tue/Wed/Thu) the operator reviews crawls that may need to be
 * cancelled. Per 7.9 the engine NEVER auto-cancels -- it surfaces a review queue
 * to the campaign manager / city lead, who makes the call. This is the cron-side
 * scanner that builds that queue.
 *
 * It looks at every UPCOMING event (event_date today .. +7 days, not already
 * cancelled/completed) that still has at least one confirmed venue, and flags it
 * when a risk signal is present:
 *
 *   1. STRUCTURAL (7.9.1 Wave 1): the crawl can't run as built --
 *      - zero confirmed venues at all, OR
 *      - no confirmed wristband venue (the check-in anchor; 7.16.2), OR
 *      - fewer confirmed venues than the required total.
 *   2. SALES (7.9.2 Wave 2): low ticket sales unlikely to recover --
 *      - 0 tickets:   nearly always cancel (Wave 1 + Wave 2)
 *      - 1..10 tickets: operator-judgment, lean-cancel band
 *      (11+ is left alone -- the 70-80%-day-before rule means it can still
 *      become viable.)
 *   3. VENUE WENT QUIET (7.9 + 7.16): a CONFIRMED venue on the crawl whose
 *      thread shows risk -- classified stalled_warm or an unanswered question,
 *      OR marked stale, OR no inbound reply in QUIET_DAYS days. A confirmed
 *      venue that stopped responding the week of the event is exactly the
 *      pre-cancellation signal 7.16 warns about.
 *
 * For each flagged event we notify the city lead (city_campaigns.lead_staff_id)
 * with an 'admin_message' notification linking to the event, mirroring how
 * cancellation-flow.ts step 4.5 notifies the lead. We do NOT mutate anything --
 * human-in-the-loop. No T16, no status change.
 *
 * Idempotent: emitNotification dedupes by (staffId, kind, linkPath) within a
 * window; we pass a dedupe window of one week so the same event is not
 * re-notified during the same event-week scan series (Tue/Wed/Thu).
 */

import { events, campaigns, cityCampaigns, emailThreads, venueEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

/** A confirmed venue with no inbound reply in this many days is "quiet". */
const QUIET_DAYS = 4;
/** How far ahead we scan. 7.9 review is an event-WEEK activity. */
const LOOKAHEAD_DAYS = 7;
/** At/below this ticket count a crawl is in the lean-cancel review band (7.9.2). */
const LOW_SALES_THRESHOLD = 10;
/** Dedupe window so the Tue/Wed/Thu scans don't re-notify the same event. */
const DEDUPE_MINUTES = 7 * 24 * 60;

export interface CancellationReviewRow {
  eventId: string;
  cityCampaignId: string;
  eventDate: string;
  leadStaffId: string | null;
  /** Human-readable risk reasons that put this crawl in the queue. */
  reasons: string[];
}

export interface CancellationReviewResult {
  scanned: number;
  flagged: number;
  notified: number;
  rows: CancellationReviewRow[];
}

/**
 * Scan upcoming events for cancellation-review risk signals and notify the
 * city lead. Returns the worklist rows so a worklist section can render the
 * same data without re-scanning.
 */
export async function runCancellationReview(): Promise<CancellationReviewResult> {
  const now = new Date();
  const today = isoDate(now);
  const horizon = isoDate(new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000));

  // Upcoming, still-live events in the review window.
  const upcoming = await db
    .select({
      eventId: events.id,
      cityCampaignId: events.cityCampaignId,
      eventDate: events.eventDate,
      ticketSalesCount: events.ticketSalesCount,
      requiredVenueCountTotal: events.requiredVenueCountTotal,
      requiredWristbandCount: events.requiredWristbandCount,
      campaignId: cityCampaigns.campaignId,
      leadStaffId: cityCampaigns.leadStaffId,
    })
    .from(events)
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .where(
      and(
        gte(events.eventDate, today),
        lte(events.eventDate, horizon),
        // event_status enum is {planned,confirmed,completed,cancelled} -- there
        // is NO contract_signed on events (that value is venue_event_status).
        inArray(events.status, ["planned", "confirmed"]),
        sql`${events.archivedAt} IS NULL`,
      ),
    );

  const rows: CancellationReviewRow[] = [];
  let notified = 0;
  const quietCutoff = new Date(now.getTime() - QUIET_DAYS * 86_400_000);

  for (const ev of upcoming) {
    const reasons: string[] = [];

    // Confirmed venues on this event, by role.
    const confirmed = await db
      .select({
        venueEventId: venueEvents.id,
        venueId: venueEvents.venueId,
        role: venueEvents.role,
      })
      .from(venueEvents)
      .where(and(eq(venueEvents.eventId, ev.eventId), eq(venueEvents.status, "confirmed")));

    const confirmedCount = confirmed.length;
    const hasWristband = confirmed.some((c) => c.role === "wristband");

    // 1. Structural (Wave 1).
    if (confirmedCount === 0) {
      reasons.push("no confirmed venues yet");
    } else {
      if (ev.requiredWristbandCount > 0 && !hasWristband) {
        reasons.push("no confirmed wristband (check-in) venue");
      }
      if (confirmedCount < ev.requiredVenueCountTotal) {
        reasons.push(
          `lineup incomplete (${confirmedCount}/${ev.requiredVenueCountTotal} venues confirmed)`,
        );
      }
    }

    // 2. Sales (Wave 2). 0 is the strongest signal; 1..10 is the lean-cancel band.
    const sales = ev.ticketSalesCount;
    if (sales === 0) {
      reasons.push("0 tickets sold");
    } else if (sales <= LOW_SALES_THRESHOLD) {
      reasons.push(`only ${sales} ticket${sales === 1 ? "" : "s"} sold (lean-cancel band)`);
    }

    // 3. A confirmed venue went quiet. Only meaningful when we actually have
    // confirmed venues to inspect.
    if (confirmedCount > 0) {
      const confirmedVenueIds = confirmed.map((c) => c.venueId);
      const quietThreads = await db
        .select({
          venueId: emailThreads.venueId,
          classification: emailThreads.classification,
          isStale: emailThreads.isStale,
          lastInboundAt: emailThreads.lastInboundAt,
        })
        .from(emailThreads)
        .where(
          and(
            eq(emailThreads.cityCampaignId, ev.cityCampaignId),
            inArray(emailThreads.venueId, confirmedVenueIds),
          ),
        );

      let quietVenues = 0;
      for (const t of quietThreads) {
        const unansweredQuestion = t.classification === "question";
        const stalled = t.classification === "stalled_warm";
        const noInbound = t.lastInboundAt !== null && t.lastInboundAt < quietCutoff;
        if (unansweredQuestion || stalled || t.isStale || noInbound) {
          quietVenues += 1;
        }
      }
      if (quietVenues > 0) {
        reasons.push(
          `${quietVenues} confirmed venue${quietVenues === 1 ? "" : "s"} gone quiet / unanswered`,
        );
      }
    }

    if (reasons.length === 0) continue;

    const linkPath = `/events/${ev.eventId}`;
    rows.push({
      eventId: ev.eventId,
      cityCampaignId: ev.cityCampaignId,
      eventDate: ev.eventDate,
      leadStaffId: ev.leadStaffId,
      reasons,
    });

    // Notify the city lead (human-in-the-loop). Skip when there is no lead to
    // notify -- the row still surfaces in the returned worklist set.
    if (ev.leadStaffId) {
      try {
        const { emitNotification } = await import("@/app/(admin)/_actions/notifications");
        const res = await emitNotification({
          staffId: ev.leadStaffId,
          kind: "admin_message",
          title: `Cancellation review: crawl on ${ev.eventDate}`,
          body: `This crawl is flagged for review (${reasons.join("; ")}). The engine does not auto-cancel -- review the data and decide.`,
          linkPath,
          dedupeMinutes: DEDUPE_MINUTES,
        });
        if (res.created) notified += 1;
      } catch (err) {
        logger.error({ err, eventId: ev.eventId }, "cancellation-review notify failed");
      }
    }
  }

  logger.info(
    { scanned: upcoming.length, flagged: rows.length, notified },
    "cancellation review scan complete",
  );
  return { scanned: upcoming.length, flagged: rows.length, notified, rows };
}

/** YYYY-MM-DD in UTC -- matches events.event_date (a DATE column, no tz). */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
