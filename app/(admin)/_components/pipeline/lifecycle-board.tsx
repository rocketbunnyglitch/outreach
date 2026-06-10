"use client";

import type { BoardCard, LifecycleBoard as LifecycleBoardData } from "@/lib/pipeline-board";
import { type LaneKey, isDraggableLane, isDropTarget } from "@/lib/pipeline-board-core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moveVenueEventStage } from "../../pipeline/_actions";

/**
 * Venue lifecycle kanban (Phase 10). Drag a pre-confirm card between lanes to
 * change its stage; dropping on Confirmed enforces the Phase-5 stage gate
 * (contact + proposed hours) server-side before the confirmation cascade runs.
 * Confirmed/Ready/Completed/Cancelled cards are locked (use the proper flows).
 * All timestamps arrive pre-formatted -> no client date work, no hydration risk.
 */

const ACCENT: Record<LaneKey, string> = {
  lead: "bg-zinc-400",
  contacted: "bg-sky-500",
  warm: "bg-amber-500",
  negotiating: "bg-violet-500",
  confirmed: "bg-indigo-500",
  ready: "bg-emerald-500",
  completed: "bg-emerald-600/60",
  cancelled: "bg-rose-500",
};

const ROLE_LABEL: Record<string, string> = {
  wristband: "Wristband",
  middle: "Middle",
  final: "Final",
  alt_final: "Alt final",
};

const CARDS_PER_LANE = 40;

function whenLabel(days: number | null): string {
  if (days == null) return "";
  if (days < 0) return "passed";
  if (days === 0) return "today";
  return `in ${days}d`;
}

export function LifecycleBoard({ board }: { board: LifecycleBoardData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragSourceLane, setDragSourceLane] = useState<LaneKey | null>(null);
  const [overLane, setOverLane] = useState<LaneKey | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  function onDragStart(card: BoardCard) {
    setDragId(card.venueEventId);
    setDragSourceLane(card.lane);
    setMessage(null);
  }
  function onDragEnd() {
    setDragId(null);
    setDragSourceLane(null);
    setOverLane(null);
  }

  function canDropHere(lane: LaneKey): boolean {
    return dragId != null && isDropTarget(lane) && dragSourceLane !== lane;
  }

  function onDrop(lane: LaneKey) {
    const id = dragId;
    onDragEnd();
    if (!id || !isDropTarget(lane) || dragSourceLane === lane) return;
    startTransition(async () => {
      const res = await moveVenueEventStage(id, lane);
      if (res.ok) {
        setMessage({ text: "Moved.", tone: "ok" });
        router.refresh();
      } else {
        setMessage({ text: res.error ?? "Move failed.", tone: "error" });
      }
    });
  }

  if (board.total === 0) {
    return (
      <div className="card-surface p-8 text-center text-sm text-zinc-500">
        No venues in this campaign's pipeline yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {(message || board.truncated) && (
        <div className="flex items-center gap-3">
          {message && (
            <p
              className={`rounded-md px-3 py-1.5 text-sm ${
                message.tone === "error"
                  ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
              }`}
            >
              {message.text}
            </p>
          )}
          {board.truncated && (
            <p className="font-mono text-[11px] text-amber-600 dark:text-amber-400">
              Showing the most-recently-updated {board.total} venues.
            </p>
          )}
        </div>
      )}

      <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest">
        Drag a lead/emailed/warm/slot card to move its stage · dropping on Confirmed needs contact +
        hours
      </p>

      <div className={`flex gap-3 overflow-x-auto pb-3 ${pending ? "opacity-60" : ""}`}>
        {board.lanes.map((lane) => {
          const shown = lane.items.slice(0, CARDS_PER_LANE);
          const overflow = lane.items.length - shown.length;
          const highlight = overLane === lane.key && canDropHere(lane.key);
          return (
            <section
              key={lane.key}
              className="flex w-64 shrink-0 flex-col gap-2"
              onDragOver={(e) => {
                if (canDropHere(lane.key)) {
                  e.preventDefault();
                  setOverLane(lane.key);
                }
              }}
              onDragLeave={() => setOverLane((l) => (l === lane.key ? null : l))}
              onDrop={() => onDrop(lane.key)}
            >
              <header className="flex items-center justify-between gap-2 px-0.5">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${ACCENT[lane.key]}`} />
                  <h2 className="font-semibold text-sm tracking-tight">{lane.label}</h2>
                </div>
                <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                  {lane.items.length}
                </span>
              </header>
              <div
                className={`flex flex-col gap-2 rounded-lg p-2 transition-colors ${
                  highlight
                    ? "bg-indigo-100/70 ring-1 ring-indigo-400 dark:bg-indigo-950/40"
                    : "bg-zinc-100/60 dark:bg-zinc-900/40"
                }`}
              >
                {shown.length === 0 ? (
                  <p className="px-1 py-3 text-center text-[11px] text-zinc-400">—</p>
                ) : (
                  shown.map((c) => {
                    // "cold:" cards come from cold_outreach_entries (no
                    // venue_event yet) -- visible but not movable.
                    const draggable =
                      isDraggableLane(c.lane) && !c.venueEventId.startsWith("cold:");
                    const showGate = draggable && !c.canConfirm;
                    return (
                      <div
                        key={c.venueEventId}
                        draggable={draggable}
                        onDragStart={() => onDragStart(c)}
                        onDragEnd={onDragEnd}
                        className={`card-surface flex flex-col gap-1 p-2.5 ${
                          draggable ? "cursor-grab active:cursor-grabbing" : ""
                        } ${dragId === c.venueEventId ? "opacity-40" : ""}`}
                      >
                        <Link
                          href={`/venues/${c.venueId}`}
                          className="truncate font-medium text-sm hover:underline"
                        >
                          {c.venueName}
                        </Link>
                        <p className="truncate text-xs text-zinc-500">
                          {c.cityName} · {ROLE_LABEL[c.role] ?? c.role}
                        </p>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
                            {c.dateLabel}
                            {c.daysToEvent != null ? ` · ${whenLabel(c.daysToEvent)}` : ""}
                          </span>
                          {showGate && (
                            <span
                              title={`To confirm: add ${c.confirmMissing.join(" and ")}`}
                              className="font-mono text-[9px] text-amber-600 uppercase dark:text-amber-400"
                            >
                              needs info
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                {overflow > 0 && (
                  <p className="px-1 pt-1 font-mono text-[10px] text-zinc-400">+ {overflow} more</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
