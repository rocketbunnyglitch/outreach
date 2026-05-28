/**
 * Presence — Redis-backed "who's looking at what" tracking.
 *
 * Each connected staff client sends a heartbeat every 10s with the
 * route they're on (and optionally a focused row/cell). We store each
 * heartbeat as an individual Redis key with a 10-minute TTL, so a teammate
 * who has the app open but idle (or has tabbed away) still shows up — they
 * just render greyed once `lastActiveAt` is >10 min stale. No explicit cleanup.
 *
 * Data model:
 *
 *   presence:route:<route>:<staff_id>  →  JSON { displayName, focusedRowId?, focusedCellId?, at, lastActiveAt }
 *     TTL: 600s (set on every heartbeat)
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
import { publishRealtime } from "./realtime-publish";
import { getRedis } from "./redis";

const KEY_PREFIX = "presence:route:";
// 10-minute TTL so "logged in but idle" teammates linger (Google-Sheets style)
// instead of vanishing after a few missed heartbeats. While a tab is open +
// visible the 10s heartbeat keeps the entry fresh; once the tab is hidden or
// closed the entry survives up to 10 min (shown greyed/idle) then auto-expires.
const TTL_SECONDS = 600;

export interface PresenceEntry {
  staffId: string;
  displayName: string;
  /** Logical row id the staffer's focus is near (for per-row avatars; Phase 13) */
  focusedRowId?: string;
  /** Logical cell id when an inline-edit cell is active (Phase 14) */
  focusedCellId?: string;
  /** ISO timestamp of the last heartbeat the server saw (tab open / keep-alive). */
  at: string;
  /** ISO timestamp of the last real user interaction (mouse/keyboard). Used to
   *  grey out "open but idle" teammates; falls back to `at` when not sent. */
  lastActiveAt?: string;
}

/**
 * Record a heartbeat for `staffId` on `route`. Resets the 10-min TTL.
 *
 * Also publishes a presence-update realtime event when the focused row
 * or cell changes since the previous heartbeat. This is the push half
 * of the focus indicator — peers see "X is editing this cell" within
 * milliseconds of the click, instead of waiting up to 10s for their
 * next heartbeat poll.
 *
 * Fire-and-forget — failures are logged but never thrown.
 */
export async function recordHeartbeat(
  route: string,
  entry: Omit<PresenceEntry, "at"> & { displayName: string },
): Promise<void> {
  const key = `${KEY_PREFIX}${route}:${entry.staffId}`;
  const at = new Date().toISOString();
  const payload: PresenceEntry = { ...entry, at, lastActiveAt: entry.lastActiveAt ?? at };

  let prev: PresenceEntry | null = null;
  try {
    const redis = getRedis();
    const prevRaw = await redis.get(key);
    if (prevRaw) {
      try {
        prev = JSON.parse(prevRaw) as PresenceEntry;
      } catch {
        // tolerate corrupted JSON
      }
    }
    await redis.set(key, JSON.stringify(payload), "EX", TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, route, staffId: entry.staffId }, "presence heartbeat write failed");
    return;
  }

  // Publish a presence-change event when focused row or cell changed,
  // so subscribers can update peer-focus borders immediately.
  const focusChanged =
    prev?.focusedCellId !== payload.focusedCellId || prev?.focusedRowId !== payload.focusedRowId;
  const joined = prev === null;
  if (focusChanged || joined) {
    publishRealtime({
      table: `presence-route-${route}`,
      id: entry.staffId,
      type: "update",
      byStaffId: entry.staffId,
      byStaffName: entry.displayName,
    });
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
 * navigation). Optional — TTL would clean it up anyway in 10 min — but
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

export interface PresenceLocation extends PresenceEntry {
  /** The route this presence entry is on (decoded from the Redis key). */
  route: string;
}

/**
 * List every staffer present anywhere in the app, deduped to one entry per
 * staffer (their most recent route). Powers the dashboard "who's online" strip.
 * SCAN across all route buckets; ≤20 operators keeps this trivial.
 */
export async function listAllPresence(): Promise<PresenceLocation[]> {
  const redis = getRedis();
  const pattern = `${KEY_PREFIX}*`;
  const keys: string[] = [];
  try {
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 300);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");
  } catch (err) {
    logger.warn({ err }, "listAllPresence scan failed");
    return [];
  }
  if (keys.length === 0) return [];

  let values: (string | null)[] = [];
  try {
    values = await redis.mget(keys);
  } catch (err) {
    logger.warn({ err }, "listAllPresence mget failed");
    return [];
  }

  const byStaff = new Map<string, PresenceLocation>();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const v = values[i];
    if (!key || !v) continue;
    let entry: PresenceEntry;
    try {
      entry = JSON.parse(v) as PresenceEntry;
    } catch {
      continue;
    }
    const rest = key.slice(KEY_PREFIX.length);
    const lastColon = rest.lastIndexOf(":");
    if (lastColon < 0) continue;
    const route = rest.slice(0, lastColon);
    const existing = byStaff.get(entry.staffId);
    if (!existing || existing.at < entry.at) {
      byStaff.set(entry.staffId, { ...entry, route });
    }
  }
  return [...byStaff.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
}
