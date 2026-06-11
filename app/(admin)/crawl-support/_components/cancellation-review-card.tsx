import type { CancellationReviewRow } from "@/lib/cancellation-review";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * Cancellation-review queue (refdoc 7.9): crawls inside the event-week
 * window flagged by the same risk scan the cron runs (lean sales,
 * structural gaps, quiet confirmed venues). Surfaced read-only — the
 * engine NEVER auto-cancels (refdoc 0.4); a human reviews the data and
 * decides. Hidden entirely when nothing is flagged.
 *
 * Timing context (refdoc 0.2): 70-80% of tickets sell the day before,
 * so cancellation calls only make sense Tue-Thu of event week — which
 * is exactly the window this scan covers.
 */
export function CancellationReviewCard({ rows }: { rows: CancellationReviewRow[] }) {
  if (rows.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-amber-300/60 bg-amber-50/40 dark:border-amber-800/40 dark:bg-amber-950/20">
      <header className="flex items-baseline justify-between gap-3 border-amber-300/40 border-b px-5 py-3 dark:border-amber-800/30">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <h2 className="font-semibold text-sm tracking-tight">Cancellation review</h2>
        </div>
        <p className="shrink-0 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
          {rows.length} flagged · humans decide, never the engine
        </p>
      </header>
      <ul className="divide-y divide-amber-300/30 dark:divide-amber-800/20">
        {rows.map((row) => (
          <li key={row.eventId}>
            <Link
              href={`/events/${row.eventId}`}
              className="flex items-start justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-amber-500/[0.06]"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-xs text-zinc-900 dark:text-zinc-100">
                  {row.cityName ?? "Unknown city"}
                  <span className="ml-1.5 font-mono font-normal text-[10px] text-zinc-500">
                    {DATE_FMT.format(new Date(`${row.eventDate}T00:00:00Z`))}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-600 leading-snug dark:text-zinc-400">
                  {row.reasons.join(" · ")}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[10px] text-zinc-400 uppercase tracking-[0.08em]">
                review →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
