"use client";

import { cn } from "@/lib/cn";
import type { StaffActivityRow } from "@/lib/team-analytics";
import { Mail, MessageCircle, MessageSquare, PhoneCall, ShieldCheck } from "lucide-react";
import Link from "next/link";

interface Props {
  rows: StaffActivityRow[];
  windowDays: number;
}

const ROLE_LABEL: Record<string, { label: string; tone: string }> = {
  admin: {
    label: "Admin",
    tone: "bg-purple-500/15 text-purple-700 ring-purple-500/25 dark:text-purple-300",
  },
  lead: {
    label: "Lead",
    tone: "bg-blue-500/15 text-blue-700 ring-blue-500/25 dark:text-blue-300",
  },
  outreach: {
    label: "Outreach",
    tone: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  },
  readonly: {
    label: "Read-only",
    tone: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20",
  },
};

/**
 * Per-staff activity table — one row per active staff member, sorted
 * by total touches DESC.
 *
 * Columns:
 *   • Name + email + role pill
 *   • Calls          (blue accent, PhoneCall icon)
 *   • Emails sent    (emerald accent, Mail icon)
 *   • SMS sent       (orange accent, MessageSquare icon)
 *   • Total          (bold, tabular-nums)
 *   • Avg/active day (lighter; only-zero days excluded so a 3-day
 *                     vacation doesn't drag down a heavy-hitter)
 *   • Last 7 days    (mini bar chart sparkline)
 *
 * Empty state: no log entries in the window at all → quiet "no
 * activity yet" panel pointing to the cold outreach docs.
 *
 * Apple-grade row treatment: alternating zinc/white tones, hover
 * crossfade to blue/4%, transitions ease-out 150ms, tabular-nums on
 * every numeric column for vertical alignment.
 */
export function TeamAnalyticsTable({ rows, windowDays }: Props) {
  if (rows.length === 0) {
    return (
      <section className="rounded-2xl border border-zinc-200 border-dashed p-12 text-center dark:border-zinc-800">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No active staff members. Add a staff row to /admin and they'll show up here.
        </p>
      </section>
    );
  }

  const maxDailyAcrossTeam = Math.max(1, ...rows.flatMap((r) => r.daily));

  return (
    <section className="card-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-zinc-200/60 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] dark:border-zinc-800/40">
              <th className="px-5 py-2.5">Staff</th>
              <th className="w-20 px-2 py-2.5 text-right">Calls</th>
              <th className="w-20 px-2 py-2.5 text-right">Emails</th>
              <th className="w-20 px-2 py-2.5 text-right">SMS</th>
              <th className="w-20 px-2 py-2.5 text-right">Viber</th>
              <th className="w-20 px-2 py-2.5 text-right">Total</th>
              <th className="w-24 px-2 py-2.5 text-right">Avg / day</th>
              <th className="w-32 px-3 py-2.5">Last {windowDays === 7 ? "7" : windowDays} days</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const zebra = i % 2 === 1;
              const tone = zebra
                ? "bg-zinc-50/60 dark:bg-zinc-900/30"
                : "bg-white dark:bg-zinc-900/10";
              const dormant = row.totalTouches === 0;
              return (
                <tr
                  key={row.staffId}
                  className={cn(
                    tone,
                    "border-zinc-200/40 border-b transition-colors duration-150 hover:bg-blue-500/[0.03] dark:border-zinc-800/30",
                    dormant && "opacity-60",
                  )}
                >
                  {/* Name + email + role */}
                  <td className="px-5 py-3 align-middle">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={row.displayName} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/admin/analytics/${row.staffId}`}
                            className="truncate font-medium text-sm text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
                          >
                            {row.displayName}
                          </Link>
                          {row.role === "admin" && (
                            <ShieldCheck className="h-3 w-3 text-purple-500" aria-label="Admin" />
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <p className="truncate font-mono text-[10px] text-zinc-500">
                            {row.primaryEmail}
                          </p>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 font-medium font-mono text-[9px] uppercase tracking-[0.08em] ring-1 ring-inset",
                              ROLE_LABEL[row.role]?.tone ??
                                "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20",
                            )}
                          >
                            {ROLE_LABEL[row.role]?.label ?? row.role}
                          </span>
                        </div>
                      </div>
                    </div>
                  </td>

                  <NumberCell
                    value={row.calls}
                    tone="text-blue-600 dark:text-blue-400"
                    icon={PhoneCall}
                  />
                  <NumberCell
                    value={row.emailsSent}
                    tone="text-emerald-600 dark:text-emerald-400"
                    icon={Mail}
                  />
                  <NumberCell
                    value={row.smsSent}
                    tone="text-orange-600 dark:text-orange-400"
                    icon={MessageSquare}
                  />
                  <NumberCell
                    value={row.viberTouches}
                    tone="text-purple-600 dark:text-purple-400"
                    icon={MessageCircle}
                  />

                  <td className="px-2 py-3 text-right align-middle font-mono text-sm tabular-nums">
                    {row.totalTouches > 0 ? (
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {row.totalTouches.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>

                  <td className="px-2 py-3 text-right align-middle font-mono text-[11px] text-zinc-500 tabular-nums">
                    {row.avgPerActiveDay > 0 ? row.avgPerActiveDay.toFixed(1) : "—"}
                  </td>

                  <td className="px-3 py-3 align-middle">
                    <Sparkline values={row.daily} max={maxDailyAcrossTeam} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NumberCell({
  value,
  tone,
  icon: Icon,
}: {
  value: number;
  tone: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <td className="px-2 py-3 text-right align-middle">
      {value > 0 ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 font-medium font-mono text-sm tabular-nums",
            tone,
          )}
        >
          <Icon className="h-3 w-3 opacity-60" />
          {value.toLocaleString()}
        </span>
      ) : (
        <span className="font-mono text-[10px] text-zinc-400">—</span>
      )}
    </td>
  );
}

function Avatar({ name }: { name: string }) {
  // Initials from displayName (first letters of up to 2 words)
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 font-mono font-semibold text-[10px] text-zinc-700 dark:from-zinc-700 dark:to-zinc-800 dark:text-zinc-200">
      {initials || "?"}
    </div>
  );
}

function Sparkline({ values, max }: { values: number[]; max: number }) {
  if (values.every((v) => v === 0)) {
    return (
      <div className="flex h-6 items-end justify-between gap-px">
        {values.map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: positional bars
            key={i}
            className="w-full rounded-sm bg-zinc-200/60 dark:bg-zinc-800/40"
            style={{ height: "2px" }}
          />
        ))}
      </div>
    );
  }
  return (
    <div
      className="flex h-6 items-end justify-between gap-px"
      title={`Daily totals: ${values.join(", ")}`}
    >
      {values.map((v, i) => {
        const heightPct = max > 0 ? (v / max) * 100 : 0;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: positional bars
            key={i}
            className={cn(
              "w-full rounded-sm transition-all",
              v === 0
                ? "bg-zinc-200/60 dark:bg-zinc-800/40"
                : v > max * 0.66
                  ? "bg-emerald-500 dark:bg-emerald-400"
                  : v > max * 0.33
                    ? "bg-blue-500 dark:bg-blue-400"
                    : "bg-zinc-400 dark:bg-zinc-600",
            )}
            style={{ height: v === 0 ? "2px" : `${Math.max(heightPct, 8)}%` }}
          />
        );
      })}
    </div>
  );
}
