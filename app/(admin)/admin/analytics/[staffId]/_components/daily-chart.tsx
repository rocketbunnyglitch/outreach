"use client";

import { cn } from "@/lib/cn";
import type { StaffDailyDetail } from "@/lib/team-analytics";

interface Props {
  daily: StaffDailyDetail[];
  windowDays: number;
}

/**
 * Daily activity bar chart for a single operator.
 *
 * Each bar represents one day; sub-stacks within the bar break down
 * channel:
 *   • Blue  — calls
 *   • Emerald — emails sent
 *   • Orange — SMS sent
 *
 * Hovering a bar shows the date + per-channel breakdown via title
 * attribute (zero-config tooltip — no JS popover needed for this scale).
 *
 * Y-axis is implicit — the tallest bar fills the chart height, all
 * others are proportional. We don't render axis labels because the
 * per-bar tooltip already discloses the precise values, and we want
 * the visual to be glance-able.
 *
 * Empty state: when all days are zero, shows a quiet centered note
 * instead of a wall of 2px ghost bars.
 */
export function DailyChart({ daily, windowDays }: Props) {
  const max = Math.max(1, ...daily.map((d) => d.total));
  const allZero = daily.every((d) => d.total === 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm shadow-zinc-200/40 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="font-semibold text-sm tracking-tight">Daily activity</h2>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
            stacked by channel · {windowDays} day window
          </p>
        </div>
        <Legend />
      </header>

      {allZero ? (
        <div className="flex h-40 items-center justify-center text-xs text-zinc-500 italic">
          No activity in this window.
        </div>
      ) : (
        <div className="flex h-40 items-end gap-px">
          {daily.map((d) => (
            <DayBar key={d.date} day={d} max={max} />
          ))}
        </div>
      )}

      {!allZero && <DateAxis dates={daily.map((d) => d.date)} windowDays={windowDays} />}
    </section>
  );
}

function DayBar({ day, max }: { day: StaffDailyDetail; max: number }) {
  const totalPct = max > 0 ? (day.total / max) * 100 : 0;
  const callsHeight = day.total > 0 ? (day.calls / day.total) * totalPct : 0;
  const emailsHeight = day.total > 0 ? (day.emailsSent / day.total) * totalPct : 0;
  const smsHeight = day.total > 0 ? (day.smsSent / day.total) * totalPct : 0;
  const tooltip = `${day.date}: ${day.total} total (${day.calls} call, ${day.emailsSent} email, ${day.smsSent} sms)`;

  if (day.total === 0) {
    return (
      <div
        className="flex w-full flex-1 items-end justify-center"
        title={`${day.date}: no activity`}
      >
        <div className="h-[3px] w-full rounded-sm bg-zinc-200/60 dark:bg-zinc-800/40" />
      </div>
    );
  }

  return (
    <div
      className="group flex w-full flex-1 cursor-default flex-col-reverse items-stretch transition-transform hover:scale-y-[1.02] hover:opacity-90"
      title={tooltip}
    >
      {day.calls > 0 && (
        <div className="bg-blue-500 dark:bg-blue-400" style={{ height: `${callsHeight}%` }} />
      )}
      {day.emailsSent > 0 && (
        <div
          className="bg-emerald-500 dark:bg-emerald-400"
          style={{ height: `${emailsHeight}%` }}
        />
      )}
      {day.smsSent > 0 && (
        <div className="bg-orange-500 dark:bg-orange-400" style={{ height: `${smsHeight}%` }} />
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
      <LegendDot tone="bg-blue-500 dark:bg-blue-400" label="Calls" />
      <LegendDot tone="bg-emerald-500 dark:bg-emerald-400" label="Emails" />
      <LegendDot tone="bg-orange-500 dark:bg-orange-400" label="SMS" />
    </div>
  );
}

function LegendDot({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("h-2 w-2 rounded-full", tone)} />
      {label}
    </span>
  );
}

function DateAxis({ dates, windowDays }: { dates: string[]; windowDays: number }) {
  // Show ~6 labels evenly spaced regardless of window size
  const labelCount = Math.min(6, dates.length);
  const stride = Math.max(1, Math.floor(dates.length / labelCount));
  const _ = windowDays;
  return (
    <div className="mt-2 grid grid-flow-col font-mono text-[9px] text-zinc-500 tabular-nums">
      {dates.map((d, i) => (
        <div key={d} className="text-center">
          {i % stride === 0 || i === dates.length - 1 ? formatShortDate(d) : ""}
        </div>
      ))}
    </div>
  );
}

function formatShortDate(iso: string): string {
  // "2026-05-26" → "May 26"
  const [, m, day] = iso.split("-");
  if (!m || !day) return iso;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const monthIdx = Number.parseInt(m, 10) - 1;
  return `${months[monthIdx] ?? m} ${Number.parseInt(day, 10)}`;
}
