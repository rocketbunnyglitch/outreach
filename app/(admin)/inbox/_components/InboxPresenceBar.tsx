"use client";

/**
 * InboxPresenceBar — small footer-pinned indicator inside the inbox
 * left pane. Shows the avatar stack of other operators currently
 * looking at /inbox, plus a "live" pill for the realtime channel.
 *
 * Kept lightweight so it doesn't crowd the FolderList. Sits at the
 * bottom of the left pane in both /inbox and /inbox/[threadId] views.
 *
 * On a thread detail page, the avatars reflect viewers of /inbox in
 * general (not the specific thread). That's intentional for v1 —
 * per-thread viewers can be a Phase 13 follow-up if it matters.
 */

import {
  PresenceAvatarStack,
  formatRealtimeAgo,
  usePresenceHeartbeat,
  useRealtimeChannel,
} from "@/components/ui/data-table";
import { cn } from "@/lib/cn";
import { Wifi } from "lucide-react";
import { useRouter } from "next/navigation";

export function InboxPresenceBar({ currentStaffId }: { currentStaffId: string }) {
  const router = useRouter();

  const realtime = useRealtimeChannel({
    channel: "realtime:email_threads",
    currentStaffId,
    onEvent: () => router.refresh(),
  });

  const presence = usePresenceHeartbeat({
    route: "/inbox",
    currentStaffId,
  });

  return (
    <div className="mt-auto flex flex-col gap-2 border-zinc-200/60 border-t pt-3 dark:border-zinc-800/40">
      <div className="px-2">
        <PresenceAvatarStack
          people={presence.others}
          size={20}
          label={presence.others.length > 0 ? "in inbox" : undefined}
        />
      </div>
      {realtime.lastEvent && (
        <p
          className="truncate px-2 font-mono text-[10px] text-zinc-500 dark:text-zinc-400"
          title={`last update from another operator at ${realtime.lastEvent.at}`}
        >
          {realtime.lastEvent.byStaffName ?? "Someone"} updated a thread{" "}
          {formatRealtimeAgo(realtime.lastEvent.at)}
        </p>
      )}
      <div className="px-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.1em]",
            realtime.connected
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-zinc-400 dark:text-zinc-600",
          )}
          title={
            realtime.connected
              ? "Live — thread updates from teammates appear automatically"
              : "Realtime disconnected"
          }
        >
          <Wifi className="h-2.5 w-2.5" />
          {realtime.connected ? "live" : "offline"}
        </span>
      </div>
    </div>
  );
}
