import { cn } from "@/lib/cn";
import type { TeamActivitySummary } from "@/lib/team-activity";
import { Activity, Mail, Pencil, Plus, Trash2 } from "lucide-react";

/**
 * Team activity widget — server-rendered panel on the Today dashboard
 * showing what each teammate did over the last N hours. Trust-builder +
 * situational awareness.
 *
 * Each row is one teammate with:
 *   • Display name + 'active 12m ago' relative timestamp
 *   • Compact counters: ✉/☎ X · ✏ Y · 🗑 Z · ✚ W
 *   • Expandable recent-events line (top 3 most recent verbs/targets)
 *
 * Quiet visual treatment — this is a glance widget, not a primary
 * surface. Two-column layout on desktop so up to 6 teammates fit in
 * one screenful without scrolling.
 */
export function TeamActivityWidget({ summary }: { summary: TeamActivitySummary }) {
  if (summary.entries.length === 0) {
    return (
      <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-950/60">
        <header className="mb-3 flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <Activity className="h-4 w-4 self-center text-zinc-500" />
            <h2 className="font-semibold text-lg tracking-tight">Team activity</h2>
          </div>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
            last {summary.windowHours}h
          </p>
        </header>
        <p className="py-6 text-center text-sm text-zinc-500">
          No team activity in the last {summary.windowHours} hours.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-950/60">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <Activity className="h-4 w-4 self-center text-zinc-500" />
          <h2 className="font-semibold text-lg tracking-tight">Team activity</h2>
          <span className="font-mono text-[11px] text-zinc-500">
            {summary.totalEvents} event{summary.totalEvents === 1 ? "" : "s"}
          </span>
        </div>
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
          last {summary.windowHours}h
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {summary.entries.map((entry) => (
          <li
            key={entry.staffId}
            className="flex flex-col gap-2 rounded-xl border border-zinc-200/60 bg-zinc-50/30 px-3 py-2.5 dark:border-zinc-800/40 dark:bg-zinc-900/30"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                {entry.displayName}
              </span>
              <span
                className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]"
                title={entry.lastActiveAt}
              >
                {formatRelativeTime(entry.lastActiveAt)}
              </span>
            </div>

            {/* Counter chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              {entry.counts.outreach > 0 && (
                <Counter
                  icon={Mail}
                  count={entry.counts.outreach}
                  label="outreach"
                  tone="emerald"
                />
              )}
              {entry.counts.edits > 0 && (
                <Counter icon={Pencil} count={entry.counts.edits} label="edits" tone="blue" />
              )}
              {entry.counts.creates > 0 && (
                <Counter icon={Plus} count={entry.counts.creates} label="adds" tone="violet" />
              )}
              {entry.counts.archives > 0 && (
                <Counter icon={Trash2} count={entry.counts.archives} label="archives" tone="zinc" />
              )}
            </div>

            {/* Top 3 recent events */}
            {entry.recent.length > 0 && (
              <ul className="space-y-0.5 border-zinc-200/40 border-t pt-1.5 dark:border-zinc-800/30">
                {entry.recent.slice(0, 3).map((evt, i) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: ordered timeline, index is identity
                    key={i}
                    className="flex items-baseline justify-between gap-2 font-mono text-[10px]"
                  >
                    <span className="truncate text-zinc-600 dark:text-zinc-400">
                      <span className="text-zinc-400">{evt.verb}</span> {evt.target}
                    </span>
                    <span className="shrink-0 text-zinc-400">{formatRelativeTime(evt.when)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Counter({
  icon: Icon,
  count,
  label,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  label: string;
  tone: "emerald" | "blue" | "violet" | "zinc";
}) {
  const tones: Record<typeof tone, string> = {
    emerald: "text-emerald-700 bg-emerald-500/[0.08] ring-emerald-500/20 dark:text-emerald-400",
    blue: "text-blue-700 bg-blue-500/[0.08] ring-blue-500/20 dark:text-blue-400",
    violet: "text-violet-700 bg-violet-500/[0.08] ring-violet-500/20 dark:text-violet-400",
    zinc: "text-zinc-700 bg-zinc-500/[0.08] ring-zinc-500/20 dark:text-zinc-400",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] ring-1 ring-inset",
        tones[tone],
      )}
      title={`${count} ${label}`}
    >
      <Icon className="h-2.5 w-2.5" />
      <span className="tabular-nums">{count}</span>
    </span>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
