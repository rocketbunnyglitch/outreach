import { requireStaff } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { type SupportHoursData, loadSupportHours } from "@/lib/support-hours";
import { AlertTriangle, Clock } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Support Hours" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ scope?: string }>;
}

export default async function SupportHoursPage({ searchParams }: Props) {
  await requireStaff();
  const params = await searchParams;
  const allScope = params.scope === "all";

  const currentCampaign = await getCurrentCampaign();
  const campaignId = !allScope && currentCampaign ? currentCampaign.campaign.id : null;

  const data = await loadSupportHours({ campaignId });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Operate</p>
          <h1 className="mt-0.5 font-semibold text-3xl tracking-tight">Support hours</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Upcoming crawls bucketed into the two support hubs. Each crawl needs live coverage for
            its run time; the local window shifts per zone. Use the totals to balance Eastern vs PHT
            shifts.
          </p>
        </div>
        <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest">
          <Link
            href="/support-hours"
            className={cn(
              "rounded px-2 py-1",
              !allScope
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
            )}
          >
            This campaign
          </Link>
          <Link
            href="/support-hours?scope=all"
            className={cn(
              "rounded px-2 py-1",
              allScope
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
            )}
          >
            All campaigns
          </Link>
        </div>
      </header>

      <ZoneTotals data={data} />

      {data.missingCount > 0 && (
        <p className="inline-flex items-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          {data.missingCount} crawl{data.missingCount === 1 ? "" : "s"} have no start/end time set —
          excluded from the totals. Set times on the crawl to include them.
        </p>
      )}

      <CrawlTable data={data} />
    </div>
  );
}

function ZoneTotals({ data }: { data: SupportHoursData }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {data.totals.map((z) => (
        <div key={z.key} className="card-surface-quiet flex flex-col gap-2 p-4">
          <div className="flex items-baseline justify-between">
            <span className="inline-flex items-center gap-1.5 font-semibold text-sm tracking-tight">
              <Clock className="h-4 w-4 text-zinc-400" />
              {z.label}
            </span>
            <span className="font-mono text-2xl tabular-nums">
              {z.totalHours}
              <span className="ml-1 text-sm text-zinc-500">h</span>
            </span>
          </div>
          <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest">
            {z.timeZone}
          </p>
          {z.byDay.length > 0 ? (
            <ul className="mt-1 flex flex-col gap-0.5">
              {z.byDay.map((d) => (
                <li
                  key={d.day}
                  className="flex items-center justify-between text-[12px] text-zinc-600 dark:text-zinc-400"
                >
                  <span className="font-mono">{d.day}</span>
                  <span className="tabular-nums">{d.hours}h</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-zinc-500">No scheduled coverage.</p>
          )}
        </div>
      ))}
    </div>
  );
}

function CrawlTable({ data }: { data: SupportHoursData }) {
  if (data.rows.length === 0) {
    return (
      <div className="card-surface-quiet p-10 text-center text-sm text-zinc-500">
        No upcoming crawls in scope.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200/80 dark:border-zinc-800/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-zinc-200/60 border-b bg-zinc-50/60 text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] dark:border-zinc-800/40 dark:bg-zinc-900/30">
            <th className="px-3 py-2">Crawl</th>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2 text-right">Hours</th>
            <th className="px-3 py-2">Eastern</th>
            <th className="px-3 py-2">PHT</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr
              key={r.eventId}
              className="border-zinc-200/40 border-b last:border-0 dark:border-zinc-800/30"
            >
              <td className="px-3 py-2">
                <div className="font-medium">{r.cityName}</div>
                <div className="text-[11px] text-zinc-500">{r.campaignName}</div>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-zinc-500 tabular-nums">
                {r.eventDate}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {r.timesMissing ? (
                  <span className="text-amber-500">—</span>
                ) : (
                  `${Math.round(r.durationHours * 10) / 10}h`
                )}
              </td>
              <td className="px-3 py-2 font-mono text-[12px]">
                {r.zones.eastern ? (
                  <span>
                    {r.zones.eastern.localStart}–{r.zones.eastern.localEnd}
                  </span>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-[12px]">
                {r.zones.pht ? (
                  <span>
                    {r.zones.pht.localStart}–{r.zones.pht.localEnd}
                  </span>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
