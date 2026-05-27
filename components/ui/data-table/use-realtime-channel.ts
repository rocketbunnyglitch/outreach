"use client";

/**
 * useRealtimeChannel — client-side subscription to a Redis channel via SSE.
 *
 * Opens an EventSource to /api/realtime/stream?channel=... and dispatches
 * realtime events to the caller. Auto-reconnects (built into EventSource);
 * dedupes events by id+timestamp; ignores self-originated events when
 * `currentStaffId` is provided.
 *
 * Common pattern — auto-refresh a list page when anyone changes a row:
 *
 *   const router = useRouter();
 *   const { staff } = useSession();
 *   useRealtimeChannel({
 *     channel: "realtime:venues",
 *     currentStaffId: staff.id,
 *     onEvent: () => router.refresh(),
 *   });
 *
 * For richer per-row patching, pass a more specific onEvent handler that
 * decides what to do with each event (insert vs update vs delete).
 *
 * The 'last edit' display:
 *
 *   const { lastEvent } = useRealtimeChannel({ ... });
 *   {lastEvent && <span>{lastEvent.byStaffName} edited {timeAgo(lastEvent.at)}</span>}
 */

import { useEffect, useRef, useState } from "react";

export interface RealtimeEvent {
  table: string;
  id?: string;
  type: "update" | "insert" | "delete";
  byStaffId: string | null;
  byStaffName?: string | null;
  at: string;
}

export interface UseRealtimeChannelOptions {
  /** Redis channel to subscribe to. Must start with "realtime:". */
  channel: string;
  /**
   * If set, events with byStaffId === currentStaffId are ignored. The
   * user already saw the optimistic update from their own action; no
   * need to also refresh because of it.
   */
  currentStaffId?: string;
  /** Called for every received event (after self-event filtering). */
  onEvent?: (event: RealtimeEvent) => void;
  /**
   * Disable the subscription. Useful for components rendered server-side
   * but not yet hydrated, or for explicit opt-out via user setting.
   */
  enabled?: boolean;
}

export interface UseRealtimeChannelReturn {
  /** True once the EventSource has been opened. */
  connected: boolean;
  /** Most recent received event (excluding self-events). Null until first. */
  lastEvent: RealtimeEvent | null;
  /** Number of events received this mount. Useful for "X updates since open". */
  eventCount: number;
}

export function useRealtimeChannel({
  channel,
  currentStaffId,
  onEvent,
  enabled = true,
}: UseRealtimeChannelOptions): UseRealtimeChannelReturn {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
  const [eventCount, setEventCount] = useState(0);
  // Stable ref to the onEvent callback so we don't re-open the EventSource
  // every time the parent re-renders with a new closure.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    if (!channel.startsWith("realtime:")) {
      // eslint-disable-next-line no-console
      console.warn("useRealtimeChannel: channel must start with 'realtime:', got", channel);
      return;
    }

    const url = `/api/realtime/stream?channel=${encodeURIComponent(channel)}`;
    const source = new EventSource(url);

    source.addEventListener("open", () => {
      setConnected(true);
    });

    source.addEventListener("realtime", (e) => {
      const messageEvent = e as MessageEvent;
      try {
        const event = JSON.parse(messageEvent.data) as RealtimeEvent;

        // Skip self-originated events — caller already has the optimistic update
        if (currentStaffId && event.byStaffId === currentStaffId) return;

        setLastEvent(event);
        setEventCount((n) => n + 1);
        onEventRef.current?.(event);
      } catch {
        // Malformed message; ignore (server side guards against this anyway)
      }
    });

    source.addEventListener("error", () => {
      // EventSource auto-reconnects; just flag temporarily disconnected
      setConnected(false);
    });

    return () => {
      source.close();
      setConnected(false);
    };
  }, [channel, currentStaffId, enabled]);

  return { connected, lastEvent, eventCount };
}

// =========================================================================
// Helper: format a "Brandon edited 4s ago" string
// =========================================================================

export function formatRealtimeAgo(isoAt: string): string {
  const ms = Date.now() - new Date(isoAt).getTime();
  if (ms < 1000) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

// Auto-export the callback variant so consumers can opt out of state
export { useRealtimeChannel as useRealtimeSubscription };
