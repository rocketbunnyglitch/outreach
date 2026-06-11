import "server-only";

/**
 * Durable lineup change writer (CRM plan B1, migration 0136).
 *
 * logLineupChange() is THE hook every lineup-mutating path calls after
 * its DB write commits: confirm (events form, city sheet), cancel,
 * venue add/remove, slot/time edits. It:
 *
 *   1. inserts an append-only row into lineup_change_events (the
 *      durable log external consumers poll via
 *      GET /api/engine/lineup/changes?since=<seq>), and
 *   2. mirrors the change into the legacy in-memory ring buffer
 *      (lib/lineup-events.ts) so same-process listeners keep working —
 *      the ring is now just an optimization, the table is the truth.
 *
 * Never throws: a logging failure must not roll back or block the
 * lineup mutation itself. Payloads pass through sanitizeLineupPayload
 * so nothing private can reach the public API (never-do #6).
 */

import { lineupChangeEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { type LineupChangeType, sanitizeLineupPayload } from "@/lib/lineup-change-core";
import { type LineupChangeKind, recordLineupChange } from "@/lib/lineup-events";
import { logger } from "@/lib/logger";

/** Map durable change types onto the legacy in-memory kinds. */
const RING_KIND: Record<LineupChangeType, LineupChangeKind> = {
  confirmed: "venue_added",
  swapped: "slot_changed",
  cancelled: "venue_removed",
  slot_changed: "slot_changed",
  times_changed: "slot_changed",
  venue_added: "venue_added",
  venue_removed: "venue_removed",
};

export interface LogLineupChangeArgs {
  eventId: string;
  changeType: LineupChangeType;
  venueEventId?: string | null;
  venueId?: string | null;
  /** Arbitrary facts — sanitized down to the public allowlist before
   *  insert. Pass venueName/role/slot times freely; private fields are
   *  dropped, not your problem to filter at the call site. */
  payload?: Record<string, unknown>;
}

export async function logLineupChange(args: LogLineupChangeArgs): Promise<void> {
  const publicPayload = sanitizeLineupPayload(args.payload);
  try {
    await db.insert(lineupChangeEvents).values({
      eventId: args.eventId,
      venueEventId: args.venueEventId ?? null,
      venueId: args.venueId ?? null,
      changeType: args.changeType,
      publicPayload,
    });
  } catch (err) {
    logger.error(
      { err, eventId: args.eventId, changeType: args.changeType },
      "logLineupChange: durable insert failed (mutation unaffected)",
    );
  }
  // Same-process listeners (best-effort, never throws).
  recordLineupChange({
    eventId: args.eventId,
    kind: RING_KIND[args.changeType],
    detail: typeof publicPayload.detail === "string" ? publicPayload.detail : undefined,
  });
}
