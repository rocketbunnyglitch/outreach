"use client";

/**
 * FollowUpsList - day-grouped follow-up rows for worklist Section 3 (Phase 2.4).
 *
 * Cadence rows get "Draft now" (pulls the cron's touch forward via
 * draftCadenceTouchNow; the new draft then shows up in the Drafts section).
 * Scheduled-draft rows get "Review" (opens the existing draft in the composer).
 */

import { useToast } from "@/components/ui/toast";
import type { WorklistFollowUpRow } from "@/lib/worklist-data";
import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { draftCadenceTouchNow } from "../_actions";

function groupByDay(
  rows: WorklistFollowUpRow[],
): Array<{ label: string; rows: WorklistFollowUpRow[] }> {
  const groups: Array<{ label: string; rows: WorklistFollowUpRow[] }> = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (!last || last.label !== r.dayLabel) {
      groups.push({ label: r.dayLabel, rows: [r] });
    } else {
      last.rows.push(r);
    }
  }
  return groups;
}

export function FollowUpsList({ rows }: { rows: WorklistFollowUpRow[] }) {
  const toast = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const draftNow = (threadId: string) => {
    setPendingId(threadId);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      const res = await draftCadenceTouchNow(null, fd);
      setPendingId(null);
      if (res.ok) {
        toast.show({ kind: "success", message: "Draft created. Find it in Drafts to review." });
      } else {
        toast.show({ kind: "error", message: res.error ?? "Could not draft this touch." });
      }
    });
  };

  const review = (draftId: string) => {
    window.dispatchEvent(new CustomEvent("compose-email", { detail: { draftId } }));
  };

  return (
    <div className="flex flex-col gap-4">
      {groupByDay(rows).map((group) => (
        <div key={group.label} className="flex flex-col gap-2">
          <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-widest">
            {group.label}
          </p>
          {group.rows.map((r) => (
            <div
              key={`${r.kind}:${r.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {r.touchLabel}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">
                    {r.venueName ?? "(no venue)"}
                    {r.cityName ? <span className="text-zinc-500"> · {r.cityName}</span> : null}
                  </p>
                  {r.daysSinceLastTouch !== null ? (
                    <p className="truncate text-xs text-zinc-500">
                      {r.daysSinceLastTouch}d since last touch
                    </p>
                  ) : null}
                </div>
              </div>
              {r.kind === "cadence" ? (
                <button
                  type="button"
                  onClick={() => draftNow(r.id)}
                  disabled={pendingId === r.id}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-white text-xs disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {pendingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Draft now
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => review(r.id)}
                  className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-700"
                >
                  Review
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
