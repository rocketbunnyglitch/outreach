"use client";

/**
 * Live refresh for collaborative pages.
 *
 * Problem: one person edits a time or note, but everyone else keeps seeing
 * stale data until they manually reload. This mounts a tiny client agent that
 * re-runs the page's server components (router.refresh, a soft refresh that
 * preserves client state) when the data changes:
 *
 *   1. Instant path — reuses the presence WS sidecar's `edit` relay. After a
 *      local mutation, call notifyDataChanged(); this broadcasts to everyone
 *      else in the same `sync:<room>` and they refresh within ~300ms.
 *   2. Fallback path — a gentle visible-only poll (default 20s) so data still
 *      converges even if the WS sidecar is down or a mutation forgot to notify.
 *
 * Uses a `sync:` room prefix so it never pollutes the presence room's peer
 * list (avatar counts stay correct).
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const DATA_CHANGED_EVENT = "perse:data-changed";

/** Call right after a successful local mutation to nudge other viewers. */
export function notifyDataChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  }
}

export function LiveRefresh({ room, pollMs = 20000 }: { room: string; pollMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer != null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        router.refresh();
      }, 300);
    };

    // --- Instant path: WS edit relay (dormant-safe if sidecar isn't up) ---
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws?room=${encodeURIComponent(`sync:${room}`)}`;
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnect: number | null = null;

    const connect = () => {
      try {
        ws = new WebSocket(url);
      } catch {
        return; // sidecar not reachable — poll fallback still runs
      }
      ws.onopen = () => {
        try {
          ws?.send(JSON.stringify({ t: "hello", name: "sync" }));
        } catch {
          /* ignore */
        }
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg?.t === "edit") scheduleRefresh();
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        reconnect = window.setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
    };
    connect();

    const onLocalChange = () => {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: "edit", field: "data" }));
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener(DATA_CHANGED_EVENT, onLocalChange);

    // --- Fallback path: gentle poll while the tab is visible ---
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, pollMs);

    return () => {
      closed = true;
      window.removeEventListener(DATA_CHANGED_EVENT, onLocalChange);
      window.clearInterval(poll);
      if (reconnect != null) window.clearTimeout(reconnect);
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [room, pollMs, router]);

  return null;
}
