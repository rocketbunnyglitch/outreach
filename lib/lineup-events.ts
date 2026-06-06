/**
 * Lineup-change pub/sub hook (Spec phase 5.8).
 *
 * When a crawl lineup changes (a venue is confirmed/removed, a slot time moves,
 * a host swaps) the engine must let downstream systems know so they can re-pull
 * the public lineup:
 *
 *   - the Smart Map (5.10) re-fetches the affected event's pins
 *   - the Eventbrite venue-block push (5.9) rewrites the listing's venue block
 *
 * recordLineupChange() is the single hook engine code calls at the moment a
 * lineup mutation commits. It is intentionally tiny and dependency-light so it
 * can be dropped into any mutation path (server action, confirmation cascade,
 * slot editor) without pulling in heavy infra.
 *
 * ---------------------------------------------------------------------------
 * Durability: in-process for now, durable later (deliberate, documented).
 * ---------------------------------------------------------------------------
 * This v1 keeps a bounded in-memory ring buffer of recent changes plus a set of
 * in-process listeners. That is enough for:
 *   - a same-process consumer (e.g. a background pusher in this Node app) to
 *     subscribe via onLineupChange and react immediately, and
 *   - a polling consumer to read getRecentLineupChanges() over an HTTP route.
 *
 * It is NOT durable across a PM2 restart and does NOT fan out across multiple
 * processes. That is fine until an EXTERNAL system needs guaranteed delivery.
 *
 * TODO (durable pub/sub, when 5.9/5.10 external wiring lands):
 *   - Persist each change to a `lineup_change_events` append-only table
 *     (proposed migration 0119 -- see the engine task notes; do NOT hand-write
 *     it here). Then getRecentLineupChanges reads from that table with a
 *     since-cursor, so a restarted poller never misses an event.
 *   - For push (not poll), publish onto the existing Redis/BullMQ used elsewhere
 *     (lib/realtime-publish.ts already publishes app realtime events) and have a
 *     worker call the Eventbrite re-point + ping the Smart Map.
 *   - Until then, callers get at-most-once, best-effort, single-process delivery.
 */

export type LineupChangeKind = "venue_added" | "venue_removed" | "slot_changed" | "host_changed";

export interface LineupChange {
  /** The crawl event whose lineup changed. */
  eventId: string;
  /** What kind of change occurred. */
  kind: LineupChangeKind;
  /** Optional human-readable detail (e.g. "wristband -> The Foundry"). */
  detail?: string;
  /** Epoch millis the change was recorded. Doubles as a poll cursor. */
  at: number;
}

export interface RecordLineupChangeArgs {
  eventId: string;
  kind: LineupChangeKind;
  detail?: string;
}

type LineupChangeListener = (change: LineupChange) => void;

/** How many recent changes to retain in memory for polling consumers. */
const RING_CAPACITY = 500;

/**
 * Module-level singletons. In Next.js dev the module can be re-evaluated on
 * hot reload; that just resets the in-memory buffer, which is acceptable for a
 * best-effort v1. The durable store (TODO above) removes this caveat.
 */
const ring: LineupChange[] = [];
const listeners = new Set<LineupChangeListener>();

/**
 * Record a lineup change. Call this from any path that mutates a confirmed
 * lineup AFTER the DB write commits. Never throws -- a notification failure must
 * not roll back the underlying lineup mutation.
 *
 * Returns the recorded change (with its timestamp) for logging/testing.
 */
export function recordLineupChange(args: RecordLineupChangeArgs): LineupChange {
  const change: LineupChange = {
    eventId: args.eventId,
    kind: args.kind,
    detail: args.detail,
    at: Date.now(),
  };

  ring.push(change);
  if (ring.length > RING_CAPACITY) ring.splice(0, ring.length - RING_CAPACITY);

  // Fan out to in-process subscribers. Isolate each listener so one throwing
  // does not stop the others (and does not bubble back to the mutation path).
  for (const listener of listeners) {
    try {
      listener(change);
    } catch {
      // Best-effort: a broken listener must not break the hook. A durable
      // implementation (TODO above) would route this to the logger.
    }
  }

  return change;
}

/**
 * Subscribe to lineup changes in THIS process. Returns an unsubscribe fn.
 * Intended for a same-process background pusher (e.g. an Eventbrite re-point
 * worker). External systems should poll getRecentLineupChanges over HTTP
 * instead.
 */
export function onLineupChange(listener: LineupChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Recent lineup changes for polling consumers, newest last.
 *
 * @param sinceMs  Only return changes recorded strictly after this epoch-millis
 *                 cursor. Pass the `at` of the last change you saw to page
 *                 forward. Omit for the full retained buffer.
 * @param eventId  Optional: restrict to one crawl event.
 *
 * NOTE: this reads the in-memory ring, so it only reflects changes since the
 * current process started. Once the durable table lands (TODO at top of file)
 * this becomes a DB read and survives restarts.
 */
export function getRecentLineupChanges(opts?: {
  sinceMs?: number;
  eventId?: string;
}): LineupChange[] {
  const sinceMs = opts?.sinceMs ?? 0;
  const eventId = opts?.eventId;
  return ring.filter((c) => c.at > sinceMs && (eventId ? c.eventId === eventId : true));
}
