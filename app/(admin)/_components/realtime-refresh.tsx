"use client";

/**
 * Global live-update agent. Mounted once in the admin layout so EVERY page
 * stays fresh.
 *
 * How it works: every committed mutation publishes a firehose event on the
 * `realtime:all` Redis channel (see withAuditContext in lib/db.ts), the SSE
 * endpoint (/api/realtime/stream) streams it to the browser, and this consumer
 * soft-refreshes the current route (router.refresh preserves client state).
 * The hook filters out the editor's own events by staffId, so you never
 * refresh because of your own edit.
 *
 * Throttled so a burst (e.g. a bulk import running many mutations) collapses
 * into at most ~1 refresh / 1.2s. A slow visible-only poll is a deep fallback
 * for the rare case where the SSE stream is silently dropped by a proxy.
 */

import { useRealtimeChannel } from "@/components/ui/data-table/use-realtime-channel";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

export function RealtimeRefresh({ currentStaffId }: { currentStaffId: string }) {
  const router = useRouter();
  const timerRef = useRef<number | null>(null);

  const throttledRefresh = useCallback(() => {
    if (timerRef.current != null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      router.refresh();
    }, 1200);
  }, [router]);

  useRealtimeChannel({
    channel: "realtime:all",
    currentStaffId,
    onEvent: throttledRefresh,
  });

  // Deep fallback: refresh occasionally while the tab is visible, in case the
  // SSE stream drops without recovering.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60_000);
    return () => {
      window.clearInterval(id);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, [router]);

  return null;
}
