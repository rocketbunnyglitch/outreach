"use client";

/**
 * InboxLiveRefresh — invisible client component that subscribes to
 * realtime:email_threads and triggers router.refresh() on any
 * change, so the inbox thread list patches in place when new
 * messages arrive or other operators classify/assign threads.
 *
 * Phase E of the email-system audit. The realtime publish
 * infrastructure was already in place — every email_threads
 * mutation publishes a row event. The missing piece was a
 * subscriber on the inbox list itself.
 *
 * Behavior:
 *   - Subscribes to realtime:email_threads (table-wide channel)
 *   - Throttles router.refresh() calls to one every 2s so a
 *     burst of inbound messages doesn't hammer the page
 *   - Surfaces a small "live" pill so operators know the feed
 *     is active. The pill turns amber when disconnected and
 *     greens up when reconnected.
 *
 * Why router.refresh() and not patch-style updates:
 *   We could re-fetch the thread list client-side, but every
 *   server component on the page already has its own query
 *   path. Calling router.refresh() re-runs the page's data
 *   loaders and the React tree reconciles only the changed
 *   bits. Same net effect as a custom patcher, ~50ms slower,
 *   no risk of drift between the live view and a fresh page
 *   load.
 *
 * Mounted by both inbox/page.tsx and inbox/[threadId]/page.tsx.
 */

import { useRealtimeChannel } from "@/components/ui/data-table";
import { Wifi, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Props {
  currentStaffId: string;
}

const THROTTLE_MS = 2000;

export function InboxLiveRefresh({ currentStaffId }: Props) {
  const router = useRouter();
  const lastRefreshAt = useRef(0);
  const pendingRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pulse, setPulse] = useState(0);

  const { connected, eventCount } = useRealtimeChannel({
    channel: "realtime:email_threads",
    currentStaffId,
    onEvent: () => {
      // Throttle: if we refreshed recently, schedule a refresh for
      // the next slot instead. Coalesces bursts of inbound messages
      // (poller often fires 5-10 events at once) into a single
      // re-render.
      const now = Date.now();
      const sinceLast = now - lastRefreshAt.current;
      if (sinceLast >= THROTTLE_MS) {
        lastRefreshAt.current = now;
        router.refresh();
        setPulse((p) => p + 1);
        return;
      }
      if (pendingRefresh.current) return; // already scheduled
      pendingRefresh.current = setTimeout(() => {
        lastRefreshAt.current = Date.now();
        pendingRefresh.current = null;
        router.refresh();
        setPulse((p) => p + 1);
      }, THROTTLE_MS - sinceLast);
    },
  });

  useEffect(() => {
    return () => {
      if (pendingRefresh.current) clearTimeout(pendingRefresh.current);
    };
  }, []);

  // The pulse counter drives a subtle 400ms green-flash animation
  // on the indicator dot whenever we just refreshed. Operators
  // need a confirmation that the page is alive.
  return (
    <span
      title={
        connected
          ? `Live · ${eventCount} update${eventCount === 1 ? "" : "s"} since open`
          : "Disconnected — reconnecting…"
      }
      className="inline-flex shrink-0 items-center gap-1 font-mono text-[9px] text-zinc-500 uppercase tracking-wider"
    >
      {connected ? (
        <Wifi key={pulse} className="h-2.5 w-2.5 animate-[pulse_0.4s_ease-out] text-emerald-500" />
      ) : (
        <WifiOff className="h-2.5 w-2.5 text-amber-500" />
      )}
      <span className="hidden sm:inline">{connected ? "live" : "offline"}</span>
    </span>
  );
}
