import { requireStaff } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { getCurrentCampaign } from "@/lib/current-campaign";
import {
  type SupportCrawlRow,
  type SupportCrawlStatus,
  type SupportHoursData,
  type SupportZoneTotal,
  loadSupportHours,
} from "@/lib/support-hours";
import {
  Activity,
  AlertTriangle,
  Calendar,
  ChevronRight,
  Clock,
  Globe2,
  Lightbulb,
  Search,
  TrendingUp,
  Users,
} from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Crawl Support Hours" };
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
  const easternTotal = data.totals.find((t) => t.key === "eastern");
  const phtTotal = data.totals.find((t) => t.key === "pht");

  // Date-range label: from min start to max end across all rows with times.
  const withTimes = data.rows.filter((r) => r.startsAtMs && r.endsAtMs);
  const dateRangeLabel = formatDateRange(withTimes);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Operate</p>
          <h1 className="mt-0.5 font-semibold text-3xl tracking-tight sm:text-4xl">
            Crawl Support Hours
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            See which crawls are running, compare city-local times to our support hubs (Eastern &
            PHT), and understand total staffed hours and the full continuous support span.
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="card-surface-quiet inline-flex items-center gap-1 p-1 font-mono text-[10px] uppercase tracking-widest">
            <Link
              href="/support-hours"
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors",
                !allScope
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
              )}
            >
              This Campaign
            </Link>
            <Link
              href="/support-hours?scope=all"
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors",
                allScope
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
              )}
            >
              All Campaigns
            </Link>
          </div>
          <div className="card-surface-quiet inline-flex items-center gap-2 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200">
            <Calendar className="h-3.5 w-3.5 text-zinc-400" />
            <span className="font-mono">{dateRangeLabel}</span>
          </div>
        </div>
      </header>

      <KpiCardsRow easternTotal={easternTotal} phtTotal={phtTotal} data={data} />

      {data.missingCount > 0 && <MissingHoursBanner count={data.missingCount} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <CrawlMatrix rows={data.rows} />
        </div>
        <div className="flex flex-col gap-4">
          <PeakOverlapCard data={data} />
          <NextCrawlCard data={data} />
          <CoverageTipsCard data={data} />
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// KPI cards
// =========================================================================

function KpiCardsRow({
  easternTotal,
  phtTotal,
  data,
}: {
  easternTotal: SupportZoneTotal | undefined;
  phtTotal: SupportZoneTotal | undefined;
  data: SupportHoursData;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <HubCard
        zone={easternTotal}
        icon={<Clock className="h-4 w-4" />}
        title="Eastern Support Hub"
        accentClass="text-sky-500 dark:text-sky-400"
      />
      <HubCard
        zone={phtTotal}
        icon={<Clock className="h-4 w-4" />}
        title="PHT Support Hub"
        accentClass="text-teal-500 dark:text-teal-400"
      />
      <GlobalCoverageCard easternTotal={easternTotal} phtTotal={phtTotal} data={data} />
      <LiveCoverageCard data={data} />
    </div>
  );
}

function HubCard({
  zone,
  icon,
  title,
  accentClass,
}: {
  zone: SupportZoneTotal | undefined;
  icon: React.ReactNode;
  title: string;
  accentClass: string;
}) {
  if (!zone) {
    return (
      <div className="card-surface flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800/60",
              accentClass,
            )}
          >
            {icon}
          </span>
          <span className="font-semibold text-sm">{title}</span>
        </div>
        <p className="text-sm text-zinc-500">No coverage scheduled.</p>
      </div>
    );
  }
  return (
    <div className="card-surface flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800/60",
              accentClass,
            )}
          >
            {icon}
          </span>
          <div className="flex flex-col">
            <span className="font-semibold text-sm leading-tight">{title}</span>
            <span className="font-mono text-[10px] text-zinc-500 leading-tight">
              {zone.timeZone}
            </span>
          </div>
        </div>
        <div className="text-right">
          <span className="font-semibold text-2xl tabular-nums">
            {zone.totalHours}
            <span className="ml-0.5 font-normal text-base text-zinc-400">h</span>
          </span>
          <p className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
            Total staffed hours
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 border-zinc-200/60 border-t pt-3 text-xs dark:border-zinc-800/40">
        <KvCell
          label="Coverage span"
          value={spanLabel(zone.coverageSpanStart, zone.coverageSpanEnd)}
        />
        <KvCell label="First crawl" value={zone.firstCrawlAt ?? "—"} />
        <KvCell label="Last crawl" value={zone.lastCrawlAt ?? "—"} />
      </div>
    </div>
  );
}

function GlobalCoverageCard({
  easternTotal,
  phtTotal,
  data,
}: {
  easternTotal: SupportZoneTotal | undefined;
  phtTotal: SupportZoneTotal | undefined;
  data: SupportHoursData;
}) {
  return (
    <div className="card-surface flex flex-col gap-4 p-5">
      <div className="flex items-start gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-violet-500 dark:bg-zinc-800/60 dark:text-violet-400">
          <Globe2 className="h-4 w-4" />
        </span>
        <span className="font-semibold text-sm">Global Coverage Window</span>
      </div>
      <div>
        <span className="font-semibold text-3xl tabular-nums">
          {data.globalWindowHours}
          <span className="ml-1 font-normal text-base text-zinc-400">h span</span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 border-zinc-200/60 border-t pt-3 text-xs dark:border-zinc-800/40">
        <KvCell
          label="ET"
          value={spanLabel(easternTotal?.coverageSpanStart, easternTotal?.coverageSpanEnd)}
        />
        <KvCell
          label="PHT"
          value={spanLabel(phtTotal?.coverageSpanStart, phtTotal?.coverageSpanEnd)}
        />
      </div>
    </div>
  );
}

function LiveCoverageCard({ data }: { data: SupportHoursData }) {
  const c = data.liveCounts;
  return (
    <div className="card-surface flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-amber-500 dark:bg-zinc-800/60 dark:text-amber-400">
          <Activity className="h-4 w-4" />
        </span>
        <span className="font-semibold text-sm">Live Coverage</span>
      </div>
      <ul className="mt-1 flex flex-col gap-2 text-sm">
        <LiveRow dot="emerald" value={c.active} label="Active" />
        <LiveRow dot="sky" value={c.startingSoon} label="Starting Soon" />
        <LiveRow dot="rose" value={c.missing} label="Missing Hours" />
      </ul>
    </div>
  );
}

function LiveRow({
  dot,
  value,
  label,
}: {
  dot: "emerald" | "sky" | "rose";
  value: number;
  label: string;
}) {
  const dotClass = {
    emerald: "bg-emerald-500",
    sky: "bg-sky-500",
    rose: "bg-rose-500",
  }[dot];
  return (
    <li className="flex items-center gap-2">
      <span className={cn("h-2 w-2 rounded-full", dotClass)} />
      <span className="w-6 text-right font-semibold tabular-nums">{value}</span>
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
    </li>
  );
}

function KvCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 leading-tight">
      <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">{label}</span>
      <span className="font-medium text-zinc-700 text-[12px] tabular-nums dark:text-zinc-200">
        {value}
      </span>
    </div>
  );
}

// =========================================================================
// Missing hours banner
// =========================================================================

function MissingHoursBanner({ count }: { count: number }) {
  return (
    <div className="card-surface flex items-center justify-between gap-4 p-4 ring-1 ring-amber-500/20">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <p className="text-sm text-amber-700 dark:text-amber-200">
          <span className="font-medium">
            {count} crawl{count === 1 ? "" : "s"} {count === 1 ? "is" : "are"} missing start/end
            times
          </span>{" "}
          <span className="text-amber-700/80 dark:text-amber-300/80">
            and are excluded from support totals.
          </span>
        </p>
      </div>
      <Link
        href="/all-crawls?missingHours=1"
        className="card-surface-quiet inline-flex items-center gap-1 px-3 py-1.5 text-xs hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40"
      >
        Review missing hours
        <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

// =========================================================================
// Crawl Time Matrix
// =========================================================================

function CrawlMatrix({ rows }: { rows: SupportCrawlRow[] }) {
  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-zinc-200/60 border-b px-5 py-4 dark:border-zinc-800/40">
        <h2 className="font-semibold text-lg">Crawl Time Matrix</h2>
        <div className="hidden items-center gap-2 sm:flex">
          <div className="card-surface-quiet inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
            <Search className="h-3.5 w-3.5 text-zinc-400" />
            <span className="text-zinc-400">Search crawls…</span>
          </div>
        </div>
      </header>
      {rows.length === 0 ? (
        <p className="p-10 text-center text-sm text-zinc-500">No upcoming crawls in scope.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-zinc-200/60 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/40">
                <th className="px-4 py-3">Crawl / City</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">City Local Time</th>
                <th className="px-4 py-3">Eastern Time</th>
                <th className="px-4 py-3">PHT Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.eventId}
                  className="border-zinc-200/40 border-b last:border-0 hover:bg-zinc-50/50 dark:border-zinc-800/30 dark:hover:bg-zinc-900/30"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium leading-tight">{r.crawlLabel}</div>
                    <div className="text-[11px] text-zinc-500">{r.cityName}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-zinc-500 tabular-nums">
                    {formatShortDate(r.eventDate)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] tabular-nums">
                    {r.timesMissing ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      `${Math.round(r.durationHours * 10) / 10}h`
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px]">
                    <ZoneCell zone={r.zones.city} tz={r.cityTimezone} />
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px]">
                    <ZoneCell zone={r.zones.eastern} tz="EDT" />
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px]">
                    <ZoneCell zone={r.zones.pht} tz="GMT+8" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ZoneCell({
  zone,
  tz,
}: {
  zone: { localStart: string; localEnd: string } | null;
  tz: string;
}) {
  if (!zone) return <span className="text-zinc-400">—</span>;
  return (
    <div className="flex flex-col leading-tight">
      <span>
        {zone.localStart}–{zone.localEnd}
      </span>
      <span className="text-[10px] text-zinc-500">{tz}</span>
    </div>
  );
}

function StatusPill({ status }: { status: SupportCrawlStatus }) {
  const map: Record<SupportCrawlStatus, { label: string; classes: string }> = {
    active: {
      label: "Active",
      classes:
        "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300",
    },
    starting_soon: {
      label: "Starts Soon",
      classes: "bg-sky-500/15 text-sky-700 ring-1 ring-sky-500/30 dark:text-sky-300",
    },
    scheduled: {
      label: "Scheduled",
      classes: "bg-zinc-500/15 text-zinc-700 ring-1 ring-zinc-500/20 dark:text-zinc-300",
    },
    completed: {
      label: "Completed",
      classes: "bg-zinc-500/10 text-zinc-500 ring-1 ring-zinc-500/15",
    },
    missing: {
      label: "Missing Hours",
      classes: "bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/30 dark:text-rose-300",
    },
  };
  const cfg = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest",
        cfg.classes,
      )}
    >
      {cfg.label}
    </span>
  );
}

// =========================================================================
// Right sidebar
// =========================================================================

function PeakOverlapCard({ data }: { data: SupportHoursData }) {
  return (
    <div className="card-surface flex flex-col gap-2 p-5">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-violet-500 dark:text-violet-400" />
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          Peak Overlap
        </span>
      </div>
      {data.peakOverlap ? (
        <>
          <p className="font-semibold text-xl tabular-nums">
            {data.peakOverlap.localStartEastern} – {data.peakOverlap.localEndEastern}
          </p>
          <p className="text-[11px] text-zinc-500">Eastern Time</p>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            {data.peakOverlap.concurrentCrawls} crawls active during this window
          </p>
        </>
      ) : (
        <p className="text-sm text-zinc-500">No overlap in current scope.</p>
      )}
    </div>
  );
}

function NextCrawlCard({ data }: { data: SupportHoursData }) {
  return (
    <div className="card-surface flex flex-col gap-2 p-5">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          Next Crawl Starting
        </span>
      </div>
      {data.nextCrawl ? (
        <>
          <p className="font-semibold text-sm">{data.nextCrawl.crawlLabel}</p>
          <p className="text-[11px] text-zinc-500">Begins in</p>
          <p className="font-semibold text-2xl tabular-nums">
            {formatMs(data.nextCrawl.msUntilStart)}
          </p>
          <p className="font-mono text-[11px] text-zinc-500">
            {data.nextCrawl.localStartEastern} ET · {data.nextCrawl.startsLocalDay}
          </p>
        </>
      ) : (
        <p className="text-sm text-zinc-500">No upcoming crawls.</p>
      )}
    </div>
  );
}

function CoverageTipsCard({ data }: { data: SupportHoursData }) {
  const easternEnd = data.totals.find((t) => t.key === "eastern")?.coverageSpanEnd;
  const tip = buildCoverageTip(data, easternEnd);
  return (
    <div className="card-surface flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-amber-500 dark:text-amber-400" />
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          Coverage Tips
        </span>
      </div>
      <p className="text-xs text-zinc-700 leading-relaxed dark:text-zinc-300">{tip}</p>
      <Link
        href="/all-crawls"
        className="card-surface-quiet mt-1 inline-flex items-center justify-between gap-1 px-3 py-2 text-xs hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40"
      >
        View staffing suggestions
        <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function buildCoverageTip(data: SupportHoursData, easternEnd: string | null | undefined): string {
  if (data.liveCounts.missing > 0) {
    return `Resolve the ${data.liveCounts.missing} crawl${
      data.liveCounts.missing === 1 ? "" : "s"
    } missing start/end times so they're included in coverage totals.`;
  }
  if (data.peakOverlap && data.peakOverlap.concurrentCrawls >= 3) {
    return `Eastern shift should be staffed through ${
      easternEnd ?? "the end of the night"
    } — ${data.peakOverlap.concurrentCrawls} crawls overlap from ${
      data.peakOverlap.localStartEastern
    } to ${data.peakOverlap.localEndEastern}.`;
  }
  if (data.liveCounts.active === 0 && data.liveCounts.startingSoon === 0) {
    return "Nothing live right now. Use this window to balance the Eastern vs PHT shift assignments for the next 7 days.";
  }
  return `${data.liveCounts.active} crawl${
    data.liveCounts.active === 1 ? " is" : "s are"
  } active and ${data.liveCounts.startingSoon} starting soon. Make sure both hubs have a designated lead.`;
}

// =========================================================================
// Helpers
// =========================================================================

function spanLabel(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return "—";
  return `${start} – ${end}`;
}

function formatShortDate(iso: string): string {
  // Trust ISO YYYY-MM-DD; format as "Month DD, YYYY".
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function formatDateRange(rows: SupportCrawlRow[]): string {
  if (rows.length === 0) return "No upcoming crawls";
  const dates = rows.map((r) => r.eventDate).sort();
  const min = dates[0];
  const max = dates[dates.length - 1];
  if (!min || !max) return "No upcoming crawls";
  const minLabel = formatShortDate(min);
  const maxLabel = formatShortDate(max);
  return min === max ? minLabel : `${minLabel} – ${maxLabel}`;
}

function formatMs(ms: number): string {
  if (ms <= 0) return "now";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
