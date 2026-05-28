"use client";

/**
 * usePresenceHeartbeat — sends heartbeats on a 10s cadence and exposes
 * the current viewer roster.
 *
 * Two transports work together:
 *   1. HTTP POST /api/presence/heartbeat every 10s — claims our spot in
 *      the registry and pulls a fresh roster of who else is here.
 *   2. SSE subscription to a presence-change channel — when any peer
 *      focuses/blurs/joins/leaves, the server pushes a notification and
 *      this hook fires an immediate re-poll. Result: per-cell focus
 *      indicators update within ~50ms instead of waiting up to 10s.
 *
 * The heartbeat fires:
 *   • Immediately on mount (to claim presence right away)
 *   • Every 10s while the component is mounted AND the tab is visible
 *     (no point burning Redis writes on a backgrounded tab)
 *   • Once more when the tab becomes visible again after being hidden,
 *     so the user shows up as soon as they refocus
 *   • Immediately when focusedRowId or focusedCellId changes (so peers
 *     see "X is editing" without delay)
 *   • Immediately when ANY peer's presence changes (via SSE push)
 *
 * On unmount, fires a best-effort `drop` request (navigator.sendBeacon
 * if available — survives navigation; XHR fallback otherwise) so the
 * avatar disappears immediately for other viewers instead of waiting
 * for the 30s TTL.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface PresenceViewer {
  staffId: string;
  displayName: string;
  focusedRowId?: string;
  focusedCellId?: string;
  at: string;
  lastActiveAt?: string;
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

  // Last real user interaction (mouse/keyboard) — distinct from the keep-alive
  // beat, so peers can tell "open but idle" from "actively working".
  const lastActiveRef = useRef(Date.now());
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const mark = () => {
      lastActiveRef.current = Date.now();
    };
    const opts = { passive: true } as const;
    window.addEventListener("pointerdown", mark, opts);
    window.addEventListener("keydown", mark, opts);
    window.addEventListener("pointermove", mark, opts);
    window.addEventListener("scroll", mark, opts);
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
      window.removeEventListener("pointermove", mark);
      window.removeEventListener("scroll", mark);
    };
  }, [enabled]);

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
          lastActiveAt: new Date(lastActiveRef.current).toISOString(),
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
  // Immediate heartbeat on focus changes — so peers see "X is editing"
  // within ~50ms of the click instead of waiting up to 10s.
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!enabled) return;
    if (focusedCellId === undefined && focusedRowId === undefined) return;
    beat();
  }, [enabled, focusedCellId, focusedRowId, beat]);

  // -----------------------------------------------------------------
  // SSE: when any peer's presence changes (joined, moved focus, left),
  // re-poll the roster immediately. Keeps peer-focus indicators feeling
  // live without bumping the heartbeat cadence.
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    const channel = `realtime:presence-route-${route}`;
    const sseUrl = `/api/realtime/stream?channel=${encodeURIComponent(channel)}`;
    const source = new EventSource(sseUrl);
    source.addEventListener("realtime", (e) => {
      const messageEvent = e as MessageEvent;
      try {
        const event = JSON.parse(messageEvent.data) as { byStaffId?: string };
        // Skip self-events — we already know our own state
        if (event.byStaffId && event.byStaffId === currentStaffId) return;
        beat();
      } catch {
        // ignore malformed
      }
    });
    return () => {
      source.close();
    };
  }, [enabled, route, currentStaffId, beat]);

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
