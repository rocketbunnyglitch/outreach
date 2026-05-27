"use client";

/**
 * useLiveCursors — sends our cursor pings + subscribes to peers'.
 *
 * Send side:
 *   • Listens to mousemove on the document, throttled to 10Hz (100ms).
 *   • POSTs to /api/presence/cursor with pageX/pageY + viewport size.
 *   • Skips sending while the tab is hidden (no point).
 *   • Send-on-leave to clear our cursor for peers when our pointer
 *     exits the page.
 *
 * Receive side:
 *   • Subscribes to the cursor channel for the route via SSE.
 *   • Maintains a Map<staffId, CursorState> of live peer positions.
 *   • Auto-prunes peers whose last `at` is older than 5s (stale).
 *
 * Render: the consumer maps over `cursors` and absolute-positions a
 * colored arrow + name label at each (x, y). Done in LiveCursorsLayer.
 *
 * Performance:
 *   • 10Hz is sufficient for "I can see them moving" without feeling
 *     laggy or saturating Redis. Figma uses ~30Hz; for our scale that's
 *     overkill.
 *   • We don't keepalive past tab-hidden. Stale peers are pruned on
 *     the receive side after 5s.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface CursorState {
  staffId: string;
  displayName: string;
  x: number;
  y: number;
  /** Sender's viewport — receiver may scale. Currently unused. */
  viewportW: number;
  viewportH: number;
  at: number;
}

export interface UseLiveCursorsOptions {
  route: string;
  currentStaffId: string;
  /** Disable for users who opted out (or for mobile). */
  enabled?: boolean;
  /** Send-throttle in ms. Default 100 (10 Hz). */
  throttleMs?: number;
  /** Drop peer cursors older than this. Default 5000 ms. */
  staleMs?: number;
}

export interface UseLiveCursorsReturn {
  /** Current set of peer cursors, keyed by staffId. */
  cursors: CursorState[];
}

export function useLiveCursors({
  route,
  currentStaffId,
  enabled = true,
  throttleMs = 100,
  staleMs = 5000,
}: UseLiveCursorsOptions): UseLiveCursorsReturn {
  const [cursors, setCursors] = useState<CursorState[]>([]);
  const lastSentAt = useRef(0);

  // -----------------------------------------------------------------
  // Send: throttled mousemove → POST /api/presence/cursor
  // -----------------------------------------------------------------
  const sendCursor = useCallback(
    (x: number, y: number) => {
      const now = Date.now();
      if (now - lastSentAt.current < throttleMs) return;
      lastSentAt.current = now;

      // Fire-and-forget; we don't care about the response. keepalive lets
      // the request survive a navigation race when the user clicks a link.
      fetch("/api/presence/cursor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route,
          x,
          y,
          viewportW: window.innerWidth,
          viewportH: window.innerHeight,
        }),
        keepalive: true,
      }).catch(() => {});
    },
    [route, throttleMs],
  );

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    function onMove(e: MouseEvent) {
      if (document.visibilityState !== "visible") return;
      sendCursor(e.pageX, e.pageY);
    }
    function onLeave() {
      // Send 'cursor off page' by setting coords to -1, -1. Receivers
      // prune coordinates that are negative.
      fetch("/api/presence/cursor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route,
          x: -1,
          y: -1,
          viewportW: window.innerWidth,
          viewportH: window.innerHeight,
        }),
        keepalive: true,
      }).catch(() => {});
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, [enabled, sendCursor, route]);

  // -----------------------------------------------------------------
  // Receive: SSE subscription to per-route cursor channel
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    const channel = `realtime:cursors-route-${route}`;
    const sseUrl = `/api/realtime/stream?channel=${encodeURIComponent(channel)}`;
    const source = new EventSource(sseUrl);

    source.addEventListener("realtime", (e) => {
      const messageEvent = e as MessageEvent;
      try {
        const data = JSON.parse(messageEvent.data) as CursorState;
        if (data.staffId === currentStaffId) return;
        setCursors((prev) => {
          const filtered = prev.filter((c) => c.staffId !== data.staffId);
          // Skip rendering if the sender's cursor left the page
          if (data.x < 0 || data.y < 0) return filtered;
          return [...filtered, data];
        });
      } catch {
        // ignore malformed
      }
    });

    return () => {
      source.close();
    };
  }, [enabled, route, currentStaffId]);

  // -----------------------------------------------------------------
  // Prune stale cursors every 1s
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      const cutoff = Date.now() - staleMs;
      setCursors((prev) => {
        const fresh = prev.filter((c) => c.at >= cutoff);
        return fresh.length === prev.length ? prev : fresh;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [enabled, staleMs]);

  return { cursors };
}
