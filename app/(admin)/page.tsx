import { loadDashboardData } from "@/lib/dashboard-queries";
import { CitiesTable } from "./_components/dashboard/cities-table";
import { KpiStrip } from "./_components/dashboard/kpi-strip";
import { TasksWidget } from "./_components/dashboard/tasks-widget";

// Always render at request time — dashboard shows live counts from DB.
export const dynamic = "force-dynamic";

/**
 * Operations dashboard. Click any city row to drill into its campaigns
 * and events.
 *
 * Visual model: dark-mode-emphasized financial trading dashboard.
 * Compact KPI strip across the top, then an alternating-rows cities table
 * as the main content. Numbers are tabular-nums + Geist Mono for clean
 * column alignment.
 */
export default async function DashboardHome() {
  const data = await loadDashboardData();

  const venueProgress =
    data.kpis.venuesTargeted > 0
      ? Math.round((data.kpis.venuesConfirmed / data.kpis.venuesTargeted) * 100)
      : 0;
  const salesProgress =
    data.kpis.goalCents > 0 ? Math.round((data.kpis.salesCents / data.kpis.goalCents) * 100) : 0;
  const outreachDelta =
    data.kpis.outreachPrevWeek > 0
      ? Math.round(
          ((data.kpis.outreachThisWeek - data.kpis.outreachPrevWeek) / data.kpis.outreachPrevWeek) *
            100,
        )
      : 0;

  // Series for KPI sparklines: aggregate across all cities by index
  const aggregate30d = aggregateSeries(data.cityRows.map((c) => c.outreach30d));
  const venuesSeries = new Array(14).fill(data.kpis.venuesConfirmed);
  const salesSeries = new Array(14).fill(data.kpis.salesCents);

  const kpis = [
    {
      label: "Venues confirmed",
      value: data.kpis.venuesConfirmed.toString(),
      meta:
        data.kpis.venuesTargeted > 0
          ? `${venueProgress}% · target ${data.kpis.venuesTargeted}`
          : "no targets set",
      trend:
        venueProgress >= 80
          ? ("up" as const)
          : venueProgress >= 40
            ? ("flat" as const)
            : ("down" as const),
      series: venuesSeries,
    },
    {
      label: "Sales",
      value: formatCurrencyCompact(data.kpis.salesCents),
      meta:
        data.kpis.goalCents > 0
          ? `${salesProgress}% of ${formatCurrencyCompact(data.kpis.goalCents)}`
          : "no goals set",
      trend:
        salesProgress >= 80
          ? ("up" as const)
          : salesProgress >= 40
            ? ("flat" as const)
            : ("down" as const),
      series: salesSeries,
    },
    {
      label: "Outreach 7d",
      value: data.kpis.outreachThisWeek.toString(),
      meta:
        data.kpis.outreachPrevWeek > 0
          ? `${outreachDelta >= 0 ? "+" : ""}${outreachDelta}% vs last week`
          : "first week of data",
      trend:
        outreachDelta > 5
          ? ("up" as const)
          : outreachDelta < -5
            ? ("down" as const)
            : ("flat" as const),
      series: aggregate30d.slice(-14),
    },
    {
      label: "Events",
      value: (data.kpis.eventsConfirmed + data.kpis.eventsPlanned).toString(),
      meta: `${data.kpis.eventsConfirmed} confirmed · ${data.kpis.eventsPlanned} planned`,
      trend: "flat" as const,
    },
    {
      label: "Reply rate 30d",
      value: `${data.kpis.replyRate}%`,
      meta: "of all touchpoints",
      trend:
        data.kpis.replyRate >= 20
          ? ("up" as const)
          : data.kpis.replyRate >= 10
            ? ("flat" as const)
            : ("down" as const),
    },
  ];

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-stone-500 text-xs uppercase tracking-widest">Operations</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight ">Dashboard</h1>
        </div>
        <p className="font-mono text-stone-500 text-xs tabular-nums">
          live · {new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
        </p>
      </header>

      <KpiStrip kpis={kpis} />

      <section className="flex flex-col gap-3">
        <header className="flex items-baseline justify-between">
          <h2 className="font-semibold text-2xl tracking-tight ">Cities</h2>
          <p className="font-mono text-[10px] text-stone-500 uppercase tracking-widest">
            {data.cityRows.length} {data.cityRows.length === 1 ? "city" : "cities"} · click to
            expand
          </p>
        </header>
        <CitiesTable cities={data.cityRows} />
      </section>

      <section className="flex flex-col gap-3">
        <TasksWidget
          tasks={data.upcomingTasks}
          totalOpen={data.kpis.openTaskCount}
          overdueCount={data.kpis.overdueTaskCount}
        />
      </section>
    </div>
  );
}

function aggregateSeries(seriesList: number[][]): number[] {
  if (seriesList.length === 0) return new Array(30).fill(0);
  const length = seriesList[0]?.length ?? 30;
  const result = new Array(length).fill(0);
  for (const s of seriesList) {
    for (let i = 0; i < length; i++) {
      result[i] += s[i] ?? 0;
    }
  }
  return result;
}

function formatCurrencyCompact(cents: number): string {
  if (cents === 0) return "$0";
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}
