import { requireAdmin } from "@/lib/auth";
import { loadTeamAnalytics } from "@/lib/team-analytics";
import { Download } from "lucide-react";
import Link from "next/link";
import { DateRangePicker } from "./_components/date-range-picker";
import { TeamAnalyticsTable } from "./_components/team-analytics-table";

export const dynamic = "force-dynamic";

/**
 * /admin/analytics — admin-only team activity dashboard.
 *
 * Shows per-staff calls / emails / SMS over a configurable window
 * (default 7 days), sorted by total touches DESC so top performers
 * surface at the top of the table and dormant accounts at the
 * bottom.
 *
 * Includes a totals strip across the top (team-wide aggregates) and
 * a 7-bar mini sparkline per row so the operator can spot inactivity
 * patterns at a glance.
 *
 * Future passes:
 *   • Date range picker
 *   • Drill into per-staff detail page with day-by-day breakdown
 *   • Export CSV
 *   • Goal-vs-actual comparison once weekly call/email targets are set
 *     per staff
 */
export default async function TeamAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const windowDays = Number(params.window ?? "7");
  const data = await loadTeamAnalytics({
    windowDays: Number.isFinite(windowDays) ? windowDays : 7,
    from: params.from,
    to: params.to,
  });

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-10">
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <div>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">
            admin · team performance
          </p>
          <h1 className="mt-1 font-semibold text-3xl tracking-tight">Team analytics</h1>
          <p className="mt-1 font-mono text-[11px] text-zinc-500 tabular-nums">
            {data.windowStart} → {data.windowEnd} · {data.windowDays} days
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DownloadCsvLink
            href={(() => {
              if (params.from && params.to) {
                return `/api/admin/analytics/export.csv?from=${params.from}&to=${params.to}`;
              }
              return `/api/admin/analytics/export.csv?window=${data.windowDays}`;
            })()}
            label="Download CSV"
          />
          <WindowSelector currentWindow={data.windowDays} />
          <DateRangePicker activeFrom={params.from} activeTo={params.to} />
        </div>
      </header>

      <TotalsStrip totals={data.totals} windowDays={data.windowDays} />

      <div className="mt-6">
        <TeamAnalyticsTable rows={data.rows} windowDays={data.windowDays} />
      </div>
    </main>
  );
}

function TotalsStrip({
  totals,
  windowDays,
}: {
  totals: import("@/lib/team-analytics").TeamAnalyticsTotals;
  windowDays: number;
}) {
  const items = [
    { label: "Calls", value: totals.calls, tone: "text-blue-600 dark:text-blue-400" },
    {
      label: "Emails sent",
      value: totals.emailsSent,
      tone: "text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "SMS sent",
      value: totals.smsSent,
      tone: "text-orange-600 dark:text-orange-400",
    },
    {
      label: "Viber",
      value: totals.viberTouches,
      tone: "text-purple-600 dark:text-purple-400",
    },
    {
      label: "Total touches",
      value: totals.totalTouches,
      tone: "text-zinc-900 dark:text-zinc-100",
    },
    {
      label: "Active staff",
      value: totals.activeStaffCount,
      tone: "text-zinc-700 dark:text-zinc-300",
    },
  ];
  return (
    <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-zinc-200/80 bg-zinc-200/60 shadow-sm shadow-zinc-200/40 sm:grid-cols-3 lg:grid-cols-6 dark:border-zinc-800/60 dark:bg-zinc-800/40 dark:shadow-none">
      {items.map((it) => (
        <div key={it.label} className="bg-white px-5 py-4 dark:bg-zinc-950/60">
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
            {it.label}
          </p>
          <p className={`mt-1 font-semibold text-2xl tabular-nums tracking-tight ${it.tone}`}>
            {it.value.toLocaleString("en-US")}
          </p>
          {it.label === "Total touches" && totals.activeStaffCount > 0 && (
            <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
              ~{Math.round(totals.totalTouches / totals.activeStaffCount / windowDays)} per
              person/day
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

function WindowSelector({ currentWindow }: { currentWindow: number }) {
  const options = [
    { days: 7, label: "7d" },
    { days: 14, label: "14d" },
    { days: 30, label: "30d" },
    { days: 90, label: "90d" },
  ];
  return (
    <div className="inline-flex max-w-full flex-wrap overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
      {options.map((o) => {
        const active = o.days === currentWindow;
        return (
          <Link
            key={o.days}
            href={`/admin/analytics?window=${o.days}`}
            className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
              active
                ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Shared link styled to match the segmented WindowSelector buttons so
 * the right-side header reads as one compact control group. Uses an
 * anchor with download attr (rather than fetch+blob) — browser handles
 * the Content-Disposition header from the route and saves directly to
 * Downloads with the correct filename.
 */
function DownloadCsvLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 font-mono text-[11px] text-zinc-600 uppercase tracking-[0.08em] transition-colors hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
    >
      <Download className="h-3 w-3" />
      {label}
    </a>
  );
}
