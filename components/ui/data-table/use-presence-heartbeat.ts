"use client";

/**
 * usePresenceHeartbeat — sends heartbeats on a 10s cadence and exposes
 * the current viewer roster.
 *
 * The heartbeat fires:
 *   • Immediately on mount (to claim presence right away)
 *   • Every 10s while the component is mounted AND the tab is visible
 *     (no point burning Redis writes on a backgrounded tab)
 *   • Once more when the tab becomes visible again after being hidden,
 *     so the user shows up as soon as they refocus
 *
 * On unmount, fires a best-effort `drop` request (navigator.sendBeacon
 * if available — survives navigation; XHR fallback otherwise) so the
 * avatar disappears immediately for other viewers instead of waiting
 * for the 30s TTL.
 *
 * Usage:
 *
 *   const { viewers, others } = usePresenceHeartbeat({
 *     route: "/venues",
 *     currentStaffId: staff.id,
 *     focusedRowId: hoveredRowId,        // optional, for Phase 13
 *     focusedCellId: editingCellId,      // optional, for Phase 14
 *   });
 *   <AvatarStack people={others} />
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface PresenceViewer {
  staffId: string;
  displayName: string;
  focusedRowId?: string;
  focusedCellId?: string;
  at: string;
}

export interface UsePresenceHeartbeatOptions {
  /** The logical route key — usually the pathname. Used as the Redis bucket. */
  route: string;
  /** Current user's staff_member.id — used to filter "others" from "viewers". */
  currentStaffId: string;
  /** For per-row presence (Phase 13). Optional. */
  focusedRowId?: string;
  /** For per-cell presence (Phase 14). Optional. */
  focusedCellId?: string;
  /** Disable heartbeats. */
  enabled?: boolean;
  /** Override the heartbeat cadence (ms). Default 10_000. */
  intervalMs?: number;
}

export interface UsePresenceHeartbeatReturn {
  /** Every viewer on this route, including the current user. */
  viewers: PresenceViewer[];
  /** Viewers other than the current user. Most common consumer. */
  others: PresenceViewer[];
}

const DEFAULT_INTERVAL_MS = 10_000;

export function usePresenceHeartbeat({
  route,
  currentStaffId,
  focusedRowId,
  focusedCellId,
  enabled = true,
  intervalMs = DEFAULT_INTERVAL_MS,
}: UsePresenceHeartbeatOptions): UsePresenceHeartbeatReturn {
  const [viewers, setViewers] = useState<PresenceViewer[]>([]);
  // Latest payload — used by the unmount cleanup to call /drop with the
  // right route.
  const latestRoute = useRef(route);
  const latestFocus = useRef({ focusedRowId, focusedCellId });
  useEffect(() => {
    latestRoute.current = route;
  }, [route]);
  useEffect(() => {
    latestFocus.current = { focusedRowId, focusedCellId };
  }, [focusedRowId, focusedCellId]);

  // -----------------------------------------------------------------
  // The heartbeat call
  // -----------------------------------------------------------------
  const beat = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    try {
      const res = await fetch("/api/presence/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route: latestRoute.current,
          focusedRowId: latestFocus.current.focusedRowId,
          focusedCellId: latestFocus.current.focusedCellId,
        }),
        keepalive: true,
      });
      if (!res.ok) return;
      const data = (await res.json()) as { viewers: PresenceViewer[] };
      setViewers(data.viewers ?? []);
    } catch {
      // Network blips are normal; the next interval tick recovers
    }
  }, []);

  // -----------------------------------------------------------------
  // Interval
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    beat(); // claim presence immediately

    const id = setInterval(beat, intervalMs);

    // Refresh as soon as the tab becomes visible again
    const onVis = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, intervalMs, beat]);

  // -----------------------------------------------------------------
  // Unmount cleanup — fire a /drop so other viewers see us leave instantly
  // -----------------------------------------------------------------
  useEffect(() => {
    return () => {
      try {
        const payload = JSON.stringify({ route: latestRoute.current });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(
            "/api/presence/drop",
            new Blob([payload], { type: "application/json" }),
          );
        } else {
          // Best-effort sync fetch; some browsers ignore it post-unmount but
          // there's nothing better available
          fetch("/api/presence/drop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // ignore
      }
    };
  }, []);

  // Filter "others" client-side
  const others = viewers.filter((v) => v.staffId !== currentStaffId);

  return { viewers, others };
}
