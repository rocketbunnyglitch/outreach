import { getCurrentCampaign } from "@/lib/current-campaign";
import { loadDashboardData } from "@/lib/dashboard-queries";
import Link from "next/link";
import { CitiesTable } from "./_components/dashboard/cities-table";
import { KpiStrip } from "./_components/dashboard/kpi-strip";
import { NotesWidget } from "./_components/dashboard/notes-widget";
import { TasksWidget } from "./_components/dashboard/tasks-widget";

// Always render at request time — dashboard shows live counts from DB.
export const dynamic = "force-dynamic";

/**
 * Operations dashboard. Click any city row to drill into its campaigns
 * and events.
 *
 * Default scope: the operator's currently-selected campaign. The query
 * filters city_campaigns to just that campaign's. The "All campaigns"
 * link in the scope banner broadens the view by passing ?scope=all in
 * the URL.
 *
 * Visual model: Apple-system-grey aesthetic with financial-trading
 * compact KPI strip across the top, then an alternating-rows cities
 * table as the main content. Numbers are tabular-nums + Geist Mono.
 */
export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const params = await searchParams;
  const allCampaigns = params.scope === "all";

  const currentCampaign = await getCurrentCampaign();
  // If the operator picked a campaign in the switcher AND hasn't opted into
  // "all campaigns" via the URL, scope the dashboard to that campaign.
  const campaignId = !allCampaigns && currentCampaign ? currentCampaign.campaign.id : null;

  const data = await loadDashboardData({ campaignId });

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
      label: "Tickets sold",
      value: data.kpis.ticketsSold.toLocaleString(),
      meta: data.kpis.ticketsSold === 0 ? "no sales yet" : "across all events in scope",
      trend: "flat" as const,
      series: new Array(14).fill(data.kpis.ticketsSold),
    },
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
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Operations</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight ">Dashboard</h1>
        </div>
        <p className="font-mono text-xs text-zinc-500 tabular-nums">
          live · {new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
        </p>
      </header>

      {/* Scope banner — communicates exactly what the dashboard is showing */}
      <div className="card-surface-quiet flex items-baseline justify-between gap-3 px-4 py-2.5">
        <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-widest">
          {data.scopedCampaign ? (
            <>
              Scope:{" "}
              <span className="text-zinc-900 dark:text-zinc-100">{data.scopedCampaign.name}</span>
            </>
          ) : currentCampaign ? (
            <>
              Scope: <span className="text-zinc-900 dark:text-zinc-100">all campaigns</span>
            </>
          ) : (
            <>
              Scope: <span className="text-zinc-900 dark:text-zinc-100">all campaigns</span>{" "}
              <span className="ml-2 text-zinc-500 normal-case tracking-normal">
                (no campaign selected — pick one in the switcher to scope)
              </span>
            </>
          )}
        </p>
        {data.scopedCampaign ? (
          <Link
            href="/?scope=all"
            className="font-mono text-[11px] text-zinc-500 uppercase tracking-widest hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            view all →
          </Link>
        ) : currentCampaign ? (
          <Link
            href="/"
            className="font-mono text-[11px] text-zinc-500 uppercase tracking-widest hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ← scope to {currentCampaign.campaign.name}
          </Link>
        ) : null}
      </div>

      <KpiStrip kpis={kpis} />

      <section className="flex flex-col gap-3">
        <header className="flex items-baseline justify-between">
          <h2 className="font-semibold text-2xl tracking-tight ">Cities</h2>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
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
        <NotesWidget notes={data.recentNotes} />
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
