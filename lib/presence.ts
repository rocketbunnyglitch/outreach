/**
 * Presence — Redis-backed "who's looking at what" tracking.
 *
 * Each connected staff client sends a heartbeat every 10s with the
 * route they're on (and optionally a focused row/cell). We store each
 * heartbeat as an individual Redis key with a 30s TTL — three missed
 * heartbeats and the entry auto-expires. No need for explicit cleanup.
 *
 * Data model:
 *
 *   presence:route:<route>:<staff_id>  →  JSON { displayName, focusedRowId?, focusedCellId?, at }
 *     TTL: 30s (set on every heartbeat)
 *
 * To list viewers on a route we SCAN for matching keys + MGET. With
 * ≤20 active operators this is well under a millisecond. If presence
 * volume ever grows past a few thousand active sessions, swap to a
 * sorted set per route scored by timestamp.
 *
 * Self-filtering happens client-side — the heartbeat response includes
 * everyone (including the caller); the AvatarStack component hides the
 * caller's own dot.
 */

import { logger } from "./logger";
import { getRedis } from "./redis";

const KEY_PREFIX = "presence:route:";
const TTL_SECONDS = 30;

export interface PresenceEntry {
  staffId: string;
  displayName: string;
  /** Logical row id the staffer's focus is near (for per-row avatars; Phase 13) */
  focusedRowId?: string;
  /** Logical cell id when an inline-edit cell is active (Phase 14) */
  focusedCellId?: string;
  /** ISO timestamp of the last heartbeat the server saw. */
  at: string;
}

/**
 * Record a heartbeat for `staffId` on `route`. Resets the 30s TTL.
 * Fire-and-forget — failures are logged but never thrown.
 */
export async function recordHeartbeat(
  route: string,
  entry: Omit<PresenceEntry, "at"> & { displayName: string },
): Promise<void> {
  const key = `${KEY_PREFIX}${route}:${entry.staffId}`;
  const payload: PresenceEntry = { ...entry, at: new Date().toISOString() };
  try {
    await getRedis().set(key, JSON.stringify(payload), "EX", TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, route, staffId: entry.staffId }, "presence heartbeat write failed");
  }
}

/**
 * List the current viewers of a route. Uses SCAN, not KEYS, so a
 * future presence-volume spike doesn't stall Redis with one big O(N)
 * call.
 */
export async function listViewers(route: string): Promise<PresenceEntry[]> {
  const redis = getRedis();
  const pattern = `${KEY_PREFIX}${route}:*`;
  const keys: string[] = [];

  try {
    let cursor = "0";
    do {
      const [nextCursor, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0");
  } catch (err) {
    logger.warn({ err, route }, "presence scan failed");
    return [];
  }

  if (keys.length === 0) return [];

  try {
    const values = await redis.mget(keys);
    const entries: PresenceEntry[] = [];
    for (const v of values) {
      if (!v) continue;
      try {
        entries.push(JSON.parse(v) as PresenceEntry);
      } catch {
        // Tolerate one bad JSON value — don't crater the whole list
      }
    }
    // Sort by recency so the freshest joiners surface first
    entries.sort((a, b) => (a.at < b.at ? 1 : -1));
    return entries;
  } catch (err) {
    logger.warn({ err, route }, "presence mget failed");
    return [];
  }
}

/**
 * Remove a staffer from a route's presence (called on tab close /
 * navigation). Optional — TTL would clean it up anyway in 30s — but
 * makes departures feel immediate.
 */
export async function dropPresence(route: string, staffId: string): Promise<void> {
  const key = `${KEY_PREFIX}${route}:${staffId}`;
  try {
    await getRedis().del(key);
  } catch (err) {
    logger.warn({ err, route, staffId }, "presence drop failed");
  }
}
