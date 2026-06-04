/**
 * Worklist "all caught up" empty state (Phase 2.6).
 *
 * Rendered by the worklist page when all four section queries are empty. Loads
 * the operator's completion stats for today (drafts sent / replies handled /
 * calls completed) and shows a celebratory summary. Server component.
 */

import { loadWorklistTodayStats } from "@/lib/worklist-data";
import { PartyPopper } from "lucide-react";

export async function WorklistAllCaughtUp({ staffId }: { staffId: string }) {
  const stats = await loadWorklistTodayStats({ staffId });
  const items = [
    { value: stats.draftsSent, label: stats.draftsSent === 1 ? "draft sent" : "drafts sent" },
    {
      value: stats.repliesHandled,
      label: stats.repliesHandled === 1 ? "reply handled" : "replies handled",
    },
    {
      value: stats.callsCompleted,
      label: stats.callsCompleted === 1 ? "call completed" : "calls completed",
    },
  ];

  return (
    <section className="flex flex-col items-center gap-6 rounded-2xl border border-zinc-200 bg-zinc-50/60 px-6 py-14 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300">
        <PartyPopper className="h-7 w-7" />
      </div>
      <div>
        <h2 className="font-semibold text-2xl tracking-tight">You're all caught up for today.</h2>
        <p className="mt-1 text-sm text-zinc-500">Nothing in your queues right now. Nice work.</p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <p className="font-mono text-[11px] text-zinc-400 uppercase tracking-widest">
          Today's activity
        </p>
        <div className="flex items-stretch gap-3">
          {items.map((it) => (
            <div
              key={it.label}
              className="flex min-w-24 flex-col items-center rounded-xl border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <span className="font-semibold text-3xl tabular-nums">{it.value}</span>
              <span className="mt-1 text-xs text-zinc-500">{it.label}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="max-w-sm text-sm text-zinc-500">
        Tomorrow's queue is being built. Check back tomorrow morning.
      </p>
    </section>
  );
}
