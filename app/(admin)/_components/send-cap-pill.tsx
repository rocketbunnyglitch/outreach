"use client";

/**
 * SendCapPill — top-bar widget showing how close the operator is to
 * the daily send cap across all their connected inboxes.
 *
 * Displays a compact pill with the X / Y count and color-coded ring:
 *   green  <70% of cap (plenty of headroom)
 *   amber  70-95% (slow down)
 *   red    >=95% or every inbox paused
 *
 * Click → popover with per-inbox breakdown so the operator can see
 * which inbox is hitting the wall and what their warm-up day is.
 *
 * Renders nothing if the staff has no connected inboxes (no point
 * showing 0/0).
 */

import { cn } from "@/lib/cn";
import type { InboxCapStatus } from "@/lib/send-cap-status";
import { AlertOctagon, Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  inboxes: InboxCapStatus[];
  totalSent: number;
  totalCap: number;
  allMaxed: boolean;
}

export function SendCapPill({ inboxes, totalSent, totalCap, allMaxed }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  if (inboxes.length === 0) return null;

  const pct = totalCap > 0 ? totalSent / totalCap : 0;
  const tone =
    allMaxed || pct >= 0.95
      ? "text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-950/40 dark:border-rose-900/60"
      : pct >= 0.7
        ? "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-900/60"
        : "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-900/60";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Sent ${totalSent} / ${totalCap} today across ${inboxes.length} inbox${inboxes.length === 1 ? "" : "es"}`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] tabular-nums transition-colors",
          tone,
        )}
      >
        {allMaxed ? <AlertOctagon className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
        <span>
          {totalSent} / {totalCap}
        </span>
      </button>
      {open && (
        <div
          className={cn(
            "absolute top-full right-0 z-50 mt-1 w-80 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg",
            "dark:border-zinc-800 dark:bg-zinc-900",
          )}
        >
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
              Daily send cap
            </p>
            <p className="font-mono text-[10px] text-zinc-400 tabular-nums">rolling 24h</p>
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {inboxes.map((ib) => {
              const inboxPct = ib.effectiveCap > 0 ? ib.sent24h / ib.effectiveCap : 0;
              const barTone = ib.paused
                ? "bg-rose-500"
                : inboxPct >= 0.95
                  ? "bg-rose-500"
                  : inboxPct >= 0.7
                    ? "bg-amber-500"
                    : "bg-emerald-500";
              return (
                <li key={ib.staffOutreachEmailId} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-[11px] text-zinc-800 dark:text-zinc-200">
                      {ib.email}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums">
                      {ib.sent24h} / {ib.effectiveCap}
                    </span>
                  </div>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                    aria-hidden="true"
                  >
                    <div
                      className={cn("h-full transition-all", barTone)}
                      style={{ width: `${Math.min(100, inboxPct * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.1em]">
                    {ib.paused ? (
                      <span className="text-rose-600 dark:text-rose-400">
                        paused{ib.pausedReason ? ` · ${ib.pausedReason.slice(0, 32)}` : ""}
                      </span>
                    ) : ib.warmupDay !== null ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        warm-up day {ib.warmupDay + 1}
                      </span>
                    ) : (
                      <span className="text-zinc-400">healthy</span>
                    )}
                    <span className="text-zinc-400">
                      {Math.max(0, ib.effectiveCap - ib.sent24h)} left
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 border-zinc-200 border-t pt-2 text-[10px] text-zinc-500 dark:border-zinc-800">
            Counts include manual sends + cron-driven sends. Bulk sends pre-check this and won't
            queue past the cap.
          </p>
        </div>
      )}
    </div>
  );
}
