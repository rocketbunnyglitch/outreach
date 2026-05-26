"use client";

import { cn } from "@/lib/cn";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * StaleDataIndicator — fixed bottom-center pill that appears when the
 * page hasn't been refreshed in a while AND the operator may be
 * looking at stale data.
 *
 * Detection heuristics:
 *   • The page mounts at time T0
 *   • Background timer ticks every 30s, computing 'staleness' = now - T0
 *   • Tab visibility events factor in: if the tab was hidden, we count
 *     that as 'definitely could have missed updates' rather than just
 *     'idle'
 *   • Threshold defaults to 5 minutes — beyond that, the pill appears
 *   • Clicking 'Refresh' calls router.refresh() and resets the timer
 *
 * The pill is calm by design — zinc-toned, small, bottom-center so it
 * doesn't compete with the toast stack or the bulk-action bar. It's
 * an affordance, not an alert.
 *
 * Usage:
 *   <StaleDataIndicator />  in any page that benefits from periodic
 *                           re-fetch awareness.
 *
 * The Today dashboard and city sheets are the natural surfaces — both
 * show team-driven data that other operators may be changing live.
 */

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds

export function StaleDataIndicator() {
  const router = useRouter();
  const [isStale, setIsStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mountedAt, setMountedAt] = useState(() => Date.now());
  // Track how long the tab was hidden so we can credit that toward staleness
  const [hiddenSince, setHiddenSince] = useState<number | null>(null);

  useEffect(() => {
    let lastVisible = Date.now();

    function check() {
      const now = Date.now();
      // Don't flag stale while tab is hidden — only when it's visible
      // and the operator might be looking
      if (document.visibilityState !== "visible") return;
      if (now - mountedAt > STALE_THRESHOLD_MS) {
        setIsStale(true);
      }
    }

    const interval = setInterval(check, CHECK_INTERVAL_MS);

    function onVisibility() {
      if (document.visibilityState === "visible") {
        const hiddenFor = hiddenSince ? Date.now() - hiddenSince : 0;
        // If the tab was hidden for over a minute, that's a strong
        // signal the data is stale — flag immediately
        if (hiddenFor > 60_000) {
          setIsStale(true);
        }
        setHiddenSince(null);
        lastVisible = Date.now();
      } else {
        setHiddenSince(Date.now());
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    // Initial check after mount in case we hot-reload onto an already-stale page
    check();

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      // Reference lastVisible so lint doesn't trip
      void lastVisible;
    };
  }, [mountedAt, hiddenSince]);

  function refresh() {
    setRefreshing(true);
    router.refresh();
    // router.refresh is fire-and-forget; we don't get a Promise back.
    // Give the spinner a moment to land before we reset state.
    setTimeout(() => {
      setRefreshing(false);
      setIsStale(false);
      setMountedAt(Date.now());
    }, 600);
  }

  if (!isStale) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex justify-center">
      <button
        type="button"
        onClick={refresh}
        disabled={refreshing}
        className={cn(
          "pointer-events-auto inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white px-3 py-1.5 font-mono text-[10px] text-zinc-700 uppercase tracking-[0.08em] shadow-md transition-all hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
        )}
      >
        <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
        {refreshing ? "Refreshing…" : "View may be outdated · refresh"}
      </button>
    </div>
  );
}
