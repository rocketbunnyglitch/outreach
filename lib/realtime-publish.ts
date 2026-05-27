/**
 * Realtime publish — fire-and-forget Redis pub/sub messages so other open
 * tabs can refresh themselves when a row changes.
 *
 * Channel naming convention:
 *   realtime:<table>            — table-wide channel; subscribers care about
 *                                  any change to this table
 *   realtime:<table>:<id>       — per-row channel; subscribers only care
 *                                  about one specific record
 *
 * V1 keeps this dead-simple. Every publish includes the table, id, change
 * type, and the actor (staff_id) so the receiving UI can show "Brandon
 * just updated this". We don't ship per-field diffs in v1 — receivers call
 * router.refresh() and re-render from the latest server state.
 *
 * Why not include the diff? Because:
 *   1. Server-rendered pages already have to re-query Drizzle on refresh,
 *      so applying a diff client-side would be inconsistent with what the
 *      next page load sees
 *   2. Avoids stale or invalid intermediate states
 *   3. Reduces payload size and surface area for security/serialization bugs
 *
 * When we add per-row patching (Phase 11), we'll add a richer event shape
 * with the patched fields.
 *
 * Errors here are deliberately swallowed — failing to publish a realtime
 * notification should never break the mutation that triggered it.
 */

import { logger } from "./logger";
import { getRedis } from "./redis";

export interface RealtimeEvent {
  /** Logical table name, e.g. "venues" or "email_threads" */
  table: string;
  /** Affected row id; omitted for table-wide events like "row inserted" */
  id?: string;
  /** What happened. "update" is most common; "insert" + "delete" round it out. */
  type: "update" | "insert" | "delete";
  /** Staff member who made the change (their staff_members.id). */
  byStaffId: string | null;
  /** Optional display name for "Brandon updated this" UX. */
  byStaffName?: string | null;
  /** ISO timestamp from the server (clients shouldn't trust their own clocks). */
  at: string;
}

/**
 * Publish a realtime event. Publishes to BOTH the table-wide channel and
 * (if id is set) the per-row channel, so subscribers can pick the
 * granularity they want.
 *
 * Fire-and-forget — does not await, does not block the caller, never throws.
 */
export function publishRealtime(event: Omit<RealtimeEvent, "at">): void {
  const payload: RealtimeEvent = {
    ...event,
    at: new Date().toISOString(),
  };
  const serialized = JSON.stringify(payload);

  // Run async without awaiting; catch + log errors so a Redis hiccup
  // doesn't surface to the operator who just edited a cell.
  const redis = getRedis();
  redis.publish(`realtime:${payload.table}`, serialized).catch((err) => {
    logger.warn({ err, table: payload.table }, "realtime publish failed (table channel)");
  });

  if (payload.id) {
    redis.publish(`realtime:${payload.table}:${payload.id}`, serialized).catch((err) => {
      logger.warn(
        { err, table: payload.table, id: payload.id },
        "realtime publish failed (row channel)",
      );
    });
  }
}

/**
 * Subscribe via a separate ioredis connection. Required because the
 * shared client used elsewhere may not be in subscriber mode.
 * Returns a cleanup function.
 *
 * Used server-side from the SSE endpoint. Not meant for general use.
 */
export async function subscribeRealtime(
  channel: string,
  onMessage: (event: RealtimeEvent) => void,
): Promise<() => Promise<void>> {
  const Redis = (await import("ioredis")).default;
  const { env } = await import("./env");

  // Dedicated subscriber connection (ioredis enforces this)
  const sub = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  sub.on("error", (err) => {
    logger.warn({ err, channel }, "realtime subscriber error");
  });

  sub.on("message", (_chan, raw) => {
    try {
      const event = JSON.parse(raw) as RealtimeEvent;
      onMessage(event);
    } catch (err) {
      logger.warn({ err, channel }, "realtime message parse failed");
    }
  });

  await sub.subscribe(channel);

  return async () => {
    try {
      await sub.unsubscribe(channel);
      await sub.quit();
    } catch (err) {
      logger.warn({ err, channel }, "realtime subscriber cleanup failed");
    }
  };
}
