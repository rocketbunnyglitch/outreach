"use client";

/**
 * InboxLiveRefresh -- the "live" indicator + new-updates affordance in
 * the inbox header.
 *
 * Subscribes to realtime:email_threads and counts how many changes have
 * arrived since the operator's view was last in sync (new inbound mail,
 * another operator classifying/assigning, the poll worker ingesting).
 *
 * GMAIL-LIKE BEHAVIOR (changed): we do NOT auto-refresh the page when an
 * event arrives. Auto-refreshing re-ran the page's server loaders and
 * reflowed the thread list (and the open thread / half-typed reply)
 * underneath the operator -- the "feels buggy / it jumps" complaint.
 * Instead we surface a small clickable pill ("N new") and let the
 * operator pull the update when THEY are ready, exactly like Gmail's
 * "N new conversations" banner. Clicking it (or pressing the inbox
 * refresh) re-syncs the view.
 *
 * States:
 *   - connected, 0 pending  -> subtle "live" wifi pill
 *   - connected, N pending  -> amber clickable "N new" button
 *   - disconnected          -> "offline" pill
 *
 * Mounted by both inbox/page.tsx and inbox/[threadId]/page.tsx.
 */

import { useRealtimeChannel } from "@/components/ui/data-table";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface Props {
  currentStaffId: string;
}

export function InboxLiveRefresh({ currentStaffId }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const [refreshing, startRefresh] = useTransition();

  const { connected, eventCount } = useRealtimeChannel({
    channel: "realtime:email_threads",
    currentStaffId,
    onEvent: () => {
      // Count it; never reflow the view automatically. The operator
      // decides when to pull updates via the pill below.
      setPending((p) => p + 1);
    },
  });

  function applyUpdates() {
    setPending(0);
    startRefresh(() => {
      router.refresh();
    });
  }

  if (connected && pending > 0) {
    return (
      <button
        type="button"
        onClick={applyUpdates}
        disabled={refreshing}
        title={`${pending} new update${pending === 1 ? "" : "s"} -- click to refresh the list`}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium font-mono text-[9px] text-amber-700 uppercase tracking-wider transition-colors hover:bg-amber-200 disabled:opacity-60 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25"
      >
        <RefreshCw className={`h-2.5 w-2.5 ${refreshing ? "animate-spin" : ""}`} />
        {pending} new
      </button>
    );
  }

  return (
    <span
      title={
        connected
          ? `Live -- ${eventCount} update${eventCount === 1 ? "" : "s"} since open`
          : "Disconnected -- reconnecting..."
      }
      className="inline-flex shrink-0 items-center gap-1 font-mono text-[9px] text-zinc-500 uppercase tracking-wider"
    >
      {connected ? (
        <Wifi className="h-2.5 w-2.5 text-emerald-500" />
      ) : (
        <WifiOff className="h-2.5 w-2.5 text-amber-500" />
      )}
      <span className="hidden sm:inline">{connected ? "live" : "offline"}</span>
    </span>
  );
}
