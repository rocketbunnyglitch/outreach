import { cn } from "@/lib/cn";
import {
  type CrawlMatrixRow,
  type CrawlStatus,
  type HostShipmentRow,
  type VenueWristbandRow,
  buildCrawlMatrix,
  loadExternalHostShipments,
  loadVenueWristbandShipments,
} from "@/lib/crawl-matrix";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Grid3X3, XCircle } from "lucide-react";
import Link from "next/link";
import { HostShipmentControl } from "./_components/host-shipment-control";

export const metadata = { title: "Crawl Matrix" };
export const dynamic = "force-dynamic";

export default async function CrawlMatrixPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; view?: string }>;
}) {
  const params = await searchParams;
  const allCampaigns = params.scope === "all";
  const view =
    params.view === "hosts" ? "hosts" : params.view === "wristbands" ? "wristbands" : "coverage";

  const currentCampaign = await getCurrentCampaign();
  const campaignId = !allCampaigns && currentCampaign ? currentCampaign.campaign.id : null;

  const rows = await buildCrawlMatrix({ campaignId });
  const shipments =
    view === "hosts"
      ? await loadExternalHostShipments([...new Set(rows.map((r) => r.cityCampaignId))])
      : [];
  const shipmentByKey = new Map<string, HostShipmentRow>(
    shipments.map((s) => [`${s.externalHostId}:${s.cityCampaignId}`, s]),
  );
  const venueWristbands =
    view === "wristbands" ? await loadVenueWristbandShipments(rows.map((r) => r.eventId)) : [];
  const wristbandByEvent = new Map<string, VenueWristbandRow>(
    venueWristbands.map((w) => [w.eventId, w]),
  );

  // Group by city for the matrix layout
  const byCity = new Map<string, { cityName: string; rows: CrawlMatrixRow[] }>();
  for (const r of rows) {
    const bucket = byCity.get(r.cityId) ?? { cityName: r.cityName, rows: [] };
    bucket.rows.push(r);
    byCity.set(r.cityId, bucket);
  }
  // Sort rows within city by daypart-order then crawl number
  const dayPartOrder: Record<string, number> = {
    thursday_night: 0,
    friday_night: 1,
    saturday_day: 2,
    saturday_night: 3,
    sunday_day: 4,
    sunday_night: 5,
    other: 6,
  };
  for (const bucket of byCity.values()) {
    bucket.rows.sort((a, b) => {
      const ao = a.dayPart ? (dayPartOrder[a.dayPart] ?? 99) : 99;
      const bo = b.dayPart ? (dayPartOrder[b.dayPart] ?? 99) : 99;
      if (ao !== bo) return ao - bo;
      return (a.crawlNumber ?? 0) - (b.crawlNumber ?? 0);
    });
  }

  // Stats for the header
  const stats = {
    total: rows.length,
    complete: rows.filter((r) => r.status === "complete").length,
    atRisk: rows.filter((r) => r.status === "at_risk").length,
    needAttention: rows.filter((r) =>
      ["need_final", "need_middle", "need_wristband"].includes(r.status),
    ).length,
    stale: rows.filter((r) => r.status === "stale").length,
  };

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Operations</p>
          <h1 className="mt-1 font-semibold text-4xl tracking-tight">Crawl Matrix</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            One row per crawl. Auto-status reflects whether the venue mix (wristband + middle +
            final) is filled and whether outreach is moving.
          </p>
        </div>
      </header>

      {/* Scope banner */}
      <div className="card-surface-quiet flex items-baseline justify-between gap-3 px-4 py-2.5">
        <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-widest">
          {campaignId && currentCampaign ? (
            <>
              Scope:{" "}
              <span className="text-zinc-900 dark:text-zinc-100">
                {currentCampaign.campaign.name}
              </span>
            </>
          ) : (
            <>
              Scope: <span className="text-zinc-900 dark:text-zinc-100">all campaigns</span>
            </>
          )}
        </p>
        {campaignId ? (
          <Link
            href="/crawl-matrix?scope=all"
            className="font-mono text-[11px] text-zinc-500 uppercase tracking-widest hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            view all →
          </Link>
        ) : currentCampaign ? (
          <Link
            href="/crawl-matrix"
            className="font-mono text-[11px] text-zinc-500 uppercase tracking-widest hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ← scope to {currentCampaign.campaign.name}
          </Link>
        ) : null}
      </div>

      {/* View tabs */}
      <TabStrip view={view} allCampaigns={allCampaigns} />

      {/* Stats strip */}
      {view === "coverage" && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Crawls" value={stats.total} />
          <StatCard label="Complete" value={stats.complete} tone="emerald" />
          <StatCard label="At risk" value={stats.atRisk} tone="rose" />
          <StatCard label="Need attention" value={stats.needAttention} tone="amber" />
          <StatCard label="Stale" value={stats.stale} tone="zinc" />
        </div>
      )}

      {view === "hosts" ? (
        <HostMatrixView byCity={byCity} shipmentByKey={shipmentByKey} />
      ) : view === "wristbands" ? (
        <VenueWristbandView byCity={byCity} wristbandByEvent={wristbandByEvent} />
      ) : rows.length === 0 ? (
        <div className="card-surface border-dashed p-12 text-center">
          <Grid3X3 className="mx-auto h-8 w-8 text-zinc-400" />
          <h3 className="mt-4 font-semibold text-2xl tracking-tight">No crawls in this scope</h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Create events under a city-campaign to populate the matrix. Set daypart + crawl number
            so they sort properly here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {Array.from(byCity.entries()).map(([cityId, bucket]) => (
            <section key={cityId} className="flex flex-col gap-3">
              <header className="flex items-baseline justify-between">
                <h2 className="font-semibold text-2xl tracking-tight">{bucket.cityName}</h2>
                <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                  {bucket.rows.length} crawl{bucket.rows.length === 1 ? "" : "s"} ·{" "}
                  {bucket.rows.reduce((s, r) => s + r.ticketSalesCount, 0)} tickets sold
                </p>
              </header>
              <div className="card-surface overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
                      <th className="px-3 py-2.5">Crawl</th>
                      <th className="px-3 py-2.5">Date</th>
                      <th className="px-3 py-2.5 text-right">Tickets</th>
                      <th className="px-3 py-2.5">Wristband</th>
                      <th className="px-3 py-2.5">Middle</th>
                      <th className="px-3 py-2.5">Final</th>
                      <th className="px-3 py-2.5">Host</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {bucket.rows.map((r, i) => (
                      <CrawlRow key={r.eventId} row={r} striped={i % 2 === 1} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function CrawlRow({ row, striped }: { row: CrawlMatrixRow; striped: boolean }) {
  return (
    <tr className={striped ? "dark:bg-white/[0.015]" : ""}>
      <td className="px-3 py-2.5">
        <Link href={`/events/${row.eventId}`} className="font-medium hover:underline">
          {row.crawlLabel}
        </Link>
      </td>
      <td className="px-3 py-2.5 font-mono text-zinc-500 tabular-nums">
        {formatDate(row.eventDate)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
        {row.ticketSalesCount > 0 ? (
          <span className="font-semibold">{row.ticketSalesCount.toLocaleString()}</span>
        ) : (
          <span className="text-zinc-500">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <RoleCell name={row.wristbandVenueName} status={row.wristbandStatus} />
      </td>
      <td className="px-3 py-2.5">
        {row.middleGroupId ? (
          <Link href={`/middle-groups/${row.middleGroupId}`} className="hover:underline">
            <RoleCell
              name={row.middleGroupName}
              status={row.middleStatus}
              suffix={row.middleVenueCount > 0 ? ` (${row.middleVenueCount})` : ""}
            />
          </Link>
        ) : (
          <RoleCell
            name={row.middleVenueCount > 0 ? `${row.middleVenueCount} inline` : null}
            status={row.middleStatus}
          />
        )}
      </td>
      <td className="px-3 py-2.5">
        <RoleCell name={row.finalVenueName} status={row.finalStatus} />
      </td>
      <td className="px-3 py-2.5">
        <HostCell hostClass={row.hostClass} hostNames={row.hostNames} />
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge status={row.status} />
      </td>
      <td className="px-3 py-2.5 text-right">
        <Link href={`/events/${row.eventId}`}>
          <ChevronRight className="inline h-3.5 w-3.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" />
        </Link>
      </td>
    </tr>
  );
}

function HostCell({
  hostClass,
  hostNames,
}: {
  hostClass: "internal" | "external" | "mixed" | "none";
  hostNames: string[];
}) {
  if (hostClass === "none") {
    return (
      <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest">none</span>
    );
  }
  const tone =
    hostClass === "internal"
      ? "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300"
      : hostClass === "external"
        ? "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300"
        : "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300";
  const label =
    hostClass === "internal" ? "Internal" : hostClass === "external" ? "External" : "Mixed";
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        className={cn(
          "inline-flex w-fit items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ring-1 ring-inset",
          tone,
        )}
      >
        {label}
      </span>
      {hostNames.length > 0 && (
        <span className="text-[11px] text-zinc-500">{hostNames.join(", ")}</span>
      )}
    </span>
  );
}

function RoleCell({
  name,
  status,
  suffix = "",
}: {
  name: string | null;
  status: "confirmed" | "missing" | "pending";
  suffix?: string;
}) {
  if (status === "missing") {
    return (
      <span className="font-mono text-[10px] text-rose-500 uppercase tracking-widest">missing</span>
    );
  }
  if (status === "pending") {
    return (
      <span className="text-zinc-500">
        {name ?? "—"}
        {suffix}
        <span className="ml-1 font-mono text-[10px] text-amber-500 uppercase tracking-widest">
          pending
        </span>
      </span>
    );
  }
  return (
    <span>
      <CheckCircle2 className="mr-1 inline h-3 w-3 text-emerald-500" />
      <span className="truncate">{name ?? "—"}</span>
      {suffix}
    </span>
  );
}

function StatusBadge({ status }: { status: CrawlStatus }) {
  const config: Record<CrawlStatus, { label: string; cls: string; icon?: React.ReactNode }> = {
    complete: {
      label: "Complete",
      cls: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    at_risk: {
      label: "At risk",
      cls: "bg-rose-500/10 text-rose-500 ring-rose-500/20",
      icon: <AlertTriangle className="h-3 w-3" />,
    },
    need_final: {
      label: "Need final",
      cls: "bg-amber-500/10 text-amber-500 ring-amber-500/20",
      icon: <XCircle className="h-3 w-3" />,
    },
    need_middle: {
      label: "Need middle",
      cls: "bg-amber-500/10 text-amber-500 ring-amber-500/20",
      icon: <XCircle className="h-3 w-3" />,
    },
    need_wristband: {
      label: "Need wristband",
      cls: "bg-amber-500/10 text-amber-500 ring-amber-500/20",
      icon: <XCircle className="h-3 w-3" />,
    },
    stale: {
      label: "Stale",
      cls: "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20",
      icon: <Clock className="h-3 w-3" />,
    },
    outreach: {
      label: "Outreach",
      cls: "bg-blue-500/10 text-blue-500 ring-blue-500/20",
    },
  };
  const c = config[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ring-1 ring-inset",
        c.cls,
      )}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

function StatCard({
  label,
  value,
  tone = "zinc",
}: {
  label: string;
  value: number;
  tone?: "zinc" | "emerald" | "rose" | "amber";
}) {
  const valueColor =
    tone === "emerald"
      ? "text-emerald-500"
      : tone === "rose"
        ? "text-rose-500"
        : tone === "amber"
          ? "text-amber-500"
          : "";
  return (
    <div className="card-surface-quiet p-4">
      <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">{label}</p>
      <p className={cn("mt-2 font-mono font-semibold text-2xl tabular-nums", valueColor)}>
        {value}
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function TabStrip({
  view,
  allCampaigns,
}: {
  view: "coverage" | "wristbands" | "hosts";
  allCampaigns: boolean;
}) {
  const scopeQ = allCampaigns ? "&scope=all" : "";
  const tabs: Array<{ key: "coverage" | "wristbands" | "hosts"; label: string; href: string }> = [
    {
      key: "coverage",
      label: "Coverage",
      href: `/crawl-matrix${allCampaigns ? "?scope=all" : ""}`,
    },
    {
      key: "wristbands",
      label: "Wristbands",
      href: `/crawl-matrix?view=wristbands${scopeQ}`,
    },
    {
      key: "hosts",
      label: "Hosts",
      href: `/crawl-matrix?view=hosts${scopeQ}`,
    },
  ];
  return (
    <div className="flex gap-1 border-zinc-200 border-b dark:border-zinc-800">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn(
            "border-b-2 px-3 py-2 font-mono text-[11px] uppercase tracking-widest",
            view === t.key
              ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

function HostMatrixView({
  byCity,
  shipmentByKey,
}: {
  byCity: Map<string, { cityName: string; rows: CrawlMatrixRow[] }>;
  shipmentByKey: Map<string, HostShipmentRow>;
}) {
  const cities = Array.from(byCity.entries());
  if (cities.length === 0) {
    return (
      <div className="card-surface border-dashed p-12 text-center">
        <Grid3X3 className="mx-auto h-8 w-8 text-zinc-400" />
        <h3 className="mt-4 font-semibold text-2xl tracking-tight">No crawls in this scope</h3>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Assign hosts to crawls to track their wristband shipments here.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {cities.map(([cityId, bucket]) => (
        <section key={cityId} className="flex flex-col gap-3">
          <header className="flex items-baseline justify-between">
            <h2 className="font-semibold text-2xl tracking-tight">{bucket.cityName}</h2>
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              {bucket.rows.length} crawl{bucket.rows.length === 1 ? "" : "s"}
            </p>
          </header>
          <div className="card-surface overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
                  <th className="px-3 py-2.5">Crawl</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Hosts</th>
                  <th className="px-3 py-2.5">External-host wristband shipment</th>
                </tr>
              </thead>
              <tbody>
                {bucket.rows.map((r, i) => (
                  <HostMatrixRow
                    key={r.eventId}
                    row={r}
                    striped={i % 2 === 1}
                    shipmentByKey={shipmentByKey}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function HostMatrixRow({
  row,
  striped,
  shipmentByKey,
}: {
  row: CrawlMatrixRow;
  striped: boolean;
  shipmentByKey: Map<string, HostShipmentRow>;
}) {
  const externalHostList = row.hosts.filter((h) => h.type === "external" && h.externalHostId);
  return (
    <tr className={striped ? "dark:bg-white/[0.015]" : ""}>
      <td className="px-3 py-2.5 align-top">
        <Link href={`/events/${row.eventId}`} className="font-medium hover:underline">
          {row.crawlLabel}
        </Link>
      </td>
      <td className="px-3 py-2.5 align-top font-mono text-zinc-500 tabular-nums">
        {formatDate(row.eventDate)}
      </td>
      <td className="px-3 py-2.5 align-top">
        {row.hosts.length === 0 ? (
          <span className="text-zinc-500">No host</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.hosts.map((h, idx) => (
              <span
                key={`${h.name}-${idx}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset",
                  h.type === "external"
                    ? "bg-violet-500/10 text-violet-700 ring-violet-500/25 dark:text-violet-300"
                    : "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300",
                )}
              >
                {h.name}
                <span className="font-mono text-[8px] uppercase opacity-70">
                  {h.type === "external" ? "ext" : "int"}
                </span>
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 align-top">
        {externalHostList.length === 0 ? (
          <span className="text-zinc-500">
            {row.hosts.length === 0 ? "—" : "Internal only (paid via venue)"}
          </span>
        ) : (
          <div className="flex flex-col gap-2">
            {externalHostList.map((h) => {
              const ship = shipmentByKey.get(`${h.externalHostId}:${row.cityCampaignId}`);
              return (
                <div key={h.externalHostId} className="flex items-center gap-2">
                  <span className="text-zinc-500">{h.name}:</span>
                  <HostShipmentControl
                    externalHostId={h.externalHostId ?? ""}
                    cityCampaignId={row.cityCampaignId}
                    status={ship?.status ?? "pending"}
                    trackingNumber={ship?.trackingNumber ?? null}
                    wristbandCount={ship?.wristbandCount ?? null}
                  />
                </div>
              );
            })}
          </div>
        )}
      </td>
    </tr>
  );
}

function VenueWristbandView({
  byCity,
  wristbandByEvent,
}: {
  byCity: Map<string, { cityName: string; rows: CrawlMatrixRow[] }>;
  wristbandByEvent: Map<string, VenueWristbandRow>;
}) {
  const cities = Array.from(byCity.entries());
  if (cities.length === 0) {
    return (
      <div className="card-surface border-dashed p-12 text-center">
        <Grid3X3 className="mx-auto h-8 w-8 text-zinc-400" />
        <h3 className="mt-4 font-semibold text-2xl tracking-tight">No crawls in this scope</h3>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Wristband venues + their shipment status show here once crawls exist.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {cities.map(([cityId, bucket]) => (
        <section key={cityId} className="flex flex-col gap-3">
          <header className="flex items-baseline justify-between">
            <h2 className="font-semibold text-2xl tracking-tight">{bucket.cityName}</h2>
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              {bucket.rows.length} crawl{bucket.rows.length === 1 ? "" : "s"}
            </p>
          </header>
          <div className="card-surface overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
                  <th className="px-3 py-2.5">Crawl</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Wristband venue</th>
                  <th className="px-3 py-2.5">Shipment</th>
                  <th className="px-3 py-2.5">Tracking</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {bucket.rows.map((r, i) => {
                  const w = wristbandByEvent.get(r.eventId);
                  return (
                    <tr key={r.eventId} className={i % 2 === 1 ? "dark:bg-white/[0.015]" : ""}>
                      <td className="px-3 py-2.5">
                        <Link href={`/events/${r.eventId}`} className="font-medium hover:underline">
                          {r.crawlLabel}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-zinc-500 tabular-nums">
                        {formatDate(r.eventDate)}
                      </td>
                      <td className="px-3 py-2.5">
                        {w ? (
                          w.venueName
                        ) : (
                          <span className="text-zinc-500">No wristband venue</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {w ? (
                          <WbShipPill status={w.status} />
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-zinc-500">
                        {w?.trackingNumber ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {w ? (
                          <Link
                            href={`/wristbands?ve=${w.venueEventId}`}
                            className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider hover:text-zinc-900 dark:hover:text-zinc-100"
                          >
                            manage →
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function WbShipPill({ status }: { status: VenueWristbandRow["status"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: {
      label: "Pending",
      cls: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300",
    },
    ready_to_ship: {
      label: "Ready",
      cls: "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300",
    },
    shipped: {
      label: "Shipped",
      cls: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300",
    },
    delivered: {
      label: "Delivered",
      cls: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400",
    },
    issue: {
      label: "Issue",
      cls: "bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300",
    },
  };
  const m = (status ? map[status] : undefined) ?? {
    label: "Needs setup",
    cls: "bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:text-rose-300",
  };
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ring-1 ring-inset",
        m.cls,
      )}
    >
      {m.label}
    </span>
  );
}
