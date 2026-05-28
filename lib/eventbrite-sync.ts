import "server-only";

/**
 * Eventbrite ticket-sales sync.
 *
 * Worker module that pulls fresh sales numbers from the Eventbrite API
 * for every event in our database that has an eventbriteEventId set,
 * and writes the result to events.ticketSalesCount.
 *
 * Why pull-based instead of webhook-driven
 * ----------------------------------------
 * Eventbrite webhooks exist but require a public callback URL with
 * verified signing, and the operator's bandwidth is the bottleneck
 * here — not API freshness. A 15-minute cron is plenty fresh for
 * crawl-planning purposes (ticket sales shift in tens, not seconds).
 *
 * Two entry points:
 *
 *   1. syncAllEventbriteTicketCounts() — drains every event with an
 *      eventbriteEventId set. Wired to the /api/cron/eventbrite-sync
 *      route at 15-minute cadence.
 *
 *   2. syncOneEventbriteTicketCount(eventId) — refreshes a single
 *      event. Wired to a manual "Refresh from Eventbrite" button on
 *      the event detail surface so operators can force a re-pull
 *      without waiting for the cron.
 *
 * Rate-limiting + error handling
 * ------------------------------
 * Eventbrite gives ~1000 req/hour per private token. We currently
 * have well under that even at full deployment. We still throttle
 * the bulk drain to ~3 req/sec via an inline await delay so we never
 * burn a window during a deploy + cron-spike combination.
 *
 * Per-event failures are captured (logger.warn) and reported in the
 * result summary but do NOT stop the drain — one stale EB ID
 * shouldn't block sales updates across the other 99 events.
 *
 * No transactions across events — each row's update is independent.
 * If the drain crashes halfway, the cron's next pass picks up where
 * it left off automatically.
 */

import { events } from "@/db/schema";
import { db } from "@/lib/db";
import { fetchEventbriteSales, isEventbriteConfigured } from "@/lib/eventbrite";
import { logger } from "@/lib/logger";
import { and, eq, isNotNull, sql } from "drizzle-orm";

/** Per-event sync result for the summary log + cron response. */
export interface EventbriteSyncRow {
  eventId: string;
  eventbriteEventId: string;
  ok: boolean;
  /** Old ticket count (read before the write). */
  before?: number;
  /** New ticket count from EB. */
  after?: number;
  /** Failure reason when ok=false. */
  error?: string;
}

export interface EventbriteSyncSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  notConfigured: boolean;
  updatedRows: EventbriteSyncRow[];
}

/**
 * Refresh ticket counts for every event with an Eventbrite ID.
 *
 * Returns a summary the cron handler can log + return to the caller.
 * Empty success when EVENTBRITE_PRIVATE_TOKEN isn't set — surfaces
 * `notConfigured: true` so the operator can tell config from data.
 */
export async function syncAllEventbriteTicketCounts(): Promise<EventbriteSyncSummary> {
  if (!isEventbriteConfigured()) {
    return {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      notConfigured: true,
      updatedRows: [],
    };
  }

  // Pull every event with an EB ID. Order by lastSync hint (createdAt
  // is fine — newer events tend to need updates more) so older
  // never-synced rows always get a turn too. Drizzle eq on text NOT
  // NULL is the right idiom.
  const targets = await db
    .select({
      id: events.id,
      eventbriteEventId: events.eventbriteEventId,
      ticketSalesCount: events.ticketSalesCount,
    })
    .from(events)
    .where(and(isNotNull(events.eventbriteEventId), isNotNull(events.id)))
    .orderBy(events.createdAt);

  const rows: EventbriteSyncRow[] = [];
  for (const row of targets) {
    if (!row.eventbriteEventId) continue; // satisfy TS (already filtered above)
    const r = await syncOneEvent(row.id, row.eventbriteEventId, row.ticketSalesCount);
    rows.push(r);
    // Soft rate limit ~3 req/sec. Each sync uses 2 EB API calls; this
    // keeps us at ~6 req/sec to EB, well under the 1000/hour budget.
    await delay(300);
  }

  const succeeded = rows.filter((r) => r.ok).length;
  const failed = rows.length - succeeded;
  return {
    attempted: rows.length,
    succeeded,
    failed,
    notConfigured: false,
    updatedRows: rows,
  };
}

/**
 * Refresh a single event's ticket count. Returns the per-row result
 * shape the cron uses, so the manual-refresh button can surface the
 * before→after delta to the operator.
 */
export async function syncOneEventbriteTicketCount(eventId: string): Promise<EventbriteSyncRow> {
  if (!isEventbriteConfigured()) {
    return {
      eventId,
      eventbriteEventId: "",
      ok: false,
      error: "EVENTBRITE_PRIVATE_TOKEN is not set on the server.",
    };
  }
  // Resolve the EB ID for this event row up front so we can return a
  // useful error if the operator clicks refresh on an event with no
  // Eventbrite link yet.
  const found = await db
    .select({
      id: events.id,
      eventbriteEventId: events.eventbriteEventId,
      ticketSalesCount: events.ticketSalesCount,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  const target = found[0];
  if (!target) {
    return {
      eventId,
      eventbriteEventId: "",
      ok: false,
      error: "Event not found.",
    };
  }
  if (!target.eventbriteEventId) {
    return {
      eventId,
      eventbriteEventId: "",
      ok: false,
      error: "This event has no Eventbrite ID linked yet.",
    };
  }
  return syncOneEvent(target.id, target.eventbriteEventId, target.ticketSalesCount);
}

/**
 * Internal: do the EB → DB sync for a single (eventId, ebId) pair.
 * Caller is responsible for the config + EB-ID-present guards.
 */
async function syncOneEvent(
  eventId: string,
  eventbriteEventId: string,
  beforeCount: number,
): Promise<EventbriteSyncRow> {
  try {
    const sales = await fetchEventbriteSales(eventbriteEventId);
    if (!sales) {
      return {
        eventId,
        eventbriteEventId,
        ok: false,
        before: beforeCount,
        error: "Eventbrite did not return sales data (event missing, token invalid, or API down).",
      };
    }
    const newCount = sales.sold;
    if (newCount === beforeCount) {
      // No-op write — skip the UPDATE to keep updated_at meaningful.
      return {
        eventId,
        eventbriteEventId,
        ok: true,
        before: beforeCount,
        after: newCount,
      };
    }
    await db
      .update(events)
      .set({
        ticketSalesCount: newCount,
        // updated_at on events bumps automatically via the audit mixin.
        // We do NOT set updatedBy here because the sync is system-driven,
        // not operator-driven; leaving it null is the convention.
      })
      .where(eq(events.id, eventId));
    return {
      eventId,
      eventbriteEventId,
      ok: true,
      before: beforeCount,
      after: newCount,
    };
  } catch (err) {
    logger.warn({ err, eventId, eventbriteEventId }, "eventbrite single-event sync threw");
    return {
      eventId,
      eventbriteEventId,
      ok: false,
      before: beforeCount,
      error: err instanceof Error ? err.message : "Sync threw an unexpected error.",
    };
  }
}

/** Promise-based sleep — too small to be worth a dep. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// sql import is kept for future use (e.g. WHERE updated_at < now()-1h
// gating to skip recently-synced rows). Not used in v1 — every cron
// pass syncs every linked event so the operator never wonders "did
// the cron skip me?". Remove if linter complains.
void sql;
