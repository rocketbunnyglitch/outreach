import { cn } from "@/lib/cn";
import type { NextBestAction } from "@/lib/next-best-actions";
import { ArrowRight, Compass } from "lucide-react";
import Link from "next/link";

const CATEGORY_DOT: Record<NextBestAction["category"], string> = {
  needs_venues: "bg-rose-500",
  stale_outreach: "bg-orange-500",
  missing_times: "bg-blue-500",
  confirmed_missing_info: "bg-emerald-500",
  unassigned_lead: "bg-purple-500",
  // v2 operating-brain categories (2026-06-11): fire-drills lead red.
  replacement_urgent: "bg-rose-600",
  high_sales_missing_final: "bg-rose-500",
  v2_call_due: "bg-amber-500",
  warm_reply_waiting: "bg-sky-500",
  lifecycle_blocker: "bg-violet-500",
};

/**
 * Next Best Actions panel. Reads the campaign's current state and
 * surfaces the 5-8 highest-priority actionable items — concrete
 * next steps, not summary stats. Each row has a CTA link that
 * deep-jumps to the relevant surface (city sheet, all-crawls table,
 * etc.) so the operator can take the action without re-navigating.
 *
 * Visual: numbered list with a category-coded dot on the left and
 * an arrow CTA on the right. Renders inline below the Today widget
 * on the dashboard.
 *
 * Empty state: returns null when there's nothing to do — the
 * dashboard already has a calm "all caught up" copy in the Today
 * widget which covers the empty-state messaging.
 */
export function NextBestActionsWidget({
  actions,
}: {
  actions: NextBestAction[];
}) {
  if (actions.length === 0) return null;

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-zinc-500" />
          <h2 className="font-semibold text-sm tracking-tight">Next best actions</h2>
        </div>
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
          what to do next
        </p>
      </header>
      <ol className="flex flex-col divide-y divide-zinc-200/40 dark:divide-zinc-800/30">
        {actions.map((action, idx) => (
          <li key={action.id}>
            <Link
              href={action.ctaHref ?? "#"}
              className={cn(
                "group flex items-center gap-3 px-5 py-2.5 transition-colors",
                "hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40",
              )}
            >
              {/* Index + category dot. The dot tells the operator at a
                  glance which kind of problem this row is so they can
                  triage horizontally (all-needs-venues together, etc.) */}
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={cn("h-1.5 w-1.5 shrink-0 rounded-full", CATEGORY_DOT[action.category])}
                  aria-hidden="true"
                />
                <span className="font-mono text-[11px] text-zinc-500 tabular-nums">{idx + 1}.</span>
              </span>
              <p className="min-w-0 flex-1 text-sm text-zinc-800 dark:text-zinc-200">
                {action.label}
              </p>
              <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] group-hover:text-zinc-900 dark:group-hover:text-zinc-100">
                {action.ctaLabel}
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
