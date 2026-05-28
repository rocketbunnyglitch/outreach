"use client";

/**
 * Meeting-mode toggle for the operations dashboard.
 *
 * Live cursors are distracting during solo work, so they're OFF by default
 * and only appear when someone flips "meeting mode" on — e.g. the team is
 * reviewing the dashboard together on a call and wants to point at things.
 *
 * The flag is global (localStorage, via useMeetingMode) so turning it on here
 * also reveals cursors on the city sheets, and turning it off hides them
 * everywhere. We only open the presence WebSocket while meeting mode is on.
 */

import { cn } from "@/lib/cn";
import { Presentation } from "lucide-react";
import { PresenceAvatars, PresenceCursors, useMeetingMode, usePresence } from "../presence";

export function MeetingMode({ room, viewerName }: { room: string; viewerName: string }) {
  const [on, setOn] = useMeetingMode();

  return (
    <div className="flex items-center gap-2">
      {on && <DashboardPresence room={room} viewerName={viewerName} />}
      <button
        type="button"
        onClick={() => setOn(!on)}
        aria-pressed={on}
        title={
          on
            ? "Meeting mode on — live cursors are visible to everyone here"
            : "Turn on meeting mode to show everyone's live cursors"
        }
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
          on
            ? "border-violet-400/70 bg-violet-500/15 text-violet-700 dark:border-violet-500/50 dark:text-violet-300"
            : "border-zinc-200 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900",
        )}
      >
        <Presentation className="h-3.5 w-3.5" />
        Meeting
      </button>
    </div>
  );
}

/** Only mounted while meeting mode is on, so the WS stays closed otherwise. */
function DashboardPresence({ room, viewerName }: { room: string; viewerName: string }) {
  const { peers } = usePresence(room, viewerName);
  return (
    <>
      <PresenceAvatars peers={peers} />
      <PresenceCursors peers={peers} />
    </>
  );
}
