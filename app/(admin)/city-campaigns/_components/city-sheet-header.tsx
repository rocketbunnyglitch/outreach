import type { CitySheetData } from "@/lib/city-sheet-data";
import { cn } from "@/lib/cn";
import {
  type CityStatusPill,
  STATUS_PILL_LABEL,
  STATUS_PILL_TONE,
} from "@/lib/tracker-status-types";
import { MapPin, Printer } from "lucide-react";
import Link from "next/link";
import { AssignStatCard, EditableDashboardNote } from "./city-sheet-editables";
import { PriorityStatCard } from "./priority-stat-card";

interface Props {
  data: CitySheetData;
  /** Total sales aggregated across all crawls. */
  totalTicketsSold: number;
  /** Computed status pill (uses same logic as the dashboard). */
  statusPill: CityStatusPill;
}

/**
 * City sheet header — the premium "this city, this campaign" card.
 *
 * Hierarchy:
 *   • Eyebrow (campaign name, mono-tracked)
 *   • Title (city name, 4xl)
 *   • Sub (region, timezone)
 *   • Stat strip (priority, sales, assigned, status) — four mini-cards
 *
 * Matches the dashboard's design system so navigating from the tracker
 * to a city detail page feels like the same product, not two screens.
 */
export function CitySheetHeader({ data, totalTicketsSold, statusPill }: Props) {
  return (
    <header className="card-surface rounded-2xl p-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.18em] dark:text-zinc-400">
            {data.campaignName}
          </p>
          <Link
            href={`/city-campaigns/${data.cityCampaignId}/print`}
            target="_blank"
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.12em] transition-colors hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            aria-label="Open print sheet"
          >
            <Printer className="h-3 w-3" /> Print sheet
          </Link>
        </div>
        <h1 className="font-semibold text-4xl tracking-tight">{data.cityName}</h1>
        <p className="mt-1 flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3 w-3" />
            {data.cityRegion ?? "—"}
          </span>
          <span aria-hidden className="text-zinc-300 dark:text-zinc-700">
            ·
          </span>
          <span className="font-mono text-xs">{data.cityTimezone}</span>
        </p>
      </div>

      {/* Stat strip */}
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <PriorityStatCard cityCampaignId={data.cityCampaignId} priority={data.priority} />
        <StatCard
          label="Tickets sold"
          value={totalTicketsSold.toLocaleString()}
          mono
          tint="emerald"
          tooltip="Total tickets sold across every crawl in this city campaign."
        />
        <AssignStatCard
          cityCampaignId={data.cityCampaignId}
          leadStaffId={data.leadStaffId}
          staff={data.staff}
        />
        <div
          title="Overall status for this city, computed from crawl progress (same logic as the dashboard tracker)."
          className="flex flex-col justify-between rounded-xl border border-zinc-200/60 bg-zinc-50/40 p-3 dark:border-zinc-800/40 dark:bg-zinc-900/30"
        >
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em] dark:text-zinc-400">
            Status
          </span>
          <span
            className={cn(
              "mt-2 inline-flex w-fit items-center rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ring-1 ring-inset",
              STATUS_PILL_TONE[statusPill],
            )}
          >
            {STATUS_PILL_LABEL[statusPill]}
          </span>
        </div>
      </div>

      <EditableDashboardNote cityCampaignId={data.cityCampaignId} note={data.dashboardNote} />
    </header>
  );
}

function StatCard({
  label,
  value,
  mono,
  tint,
  icon,
  tooltip,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tint: "zinc" | "emerald" | "blue";
  icon?: React.ReactNode;
  tooltip?: string;
}) {
  const tintBg = {
    zinc: "bg-zinc-50/40 dark:bg-zinc-900/30",
    emerald: "bg-emerald-50/30 dark:bg-emerald-950/15",
    blue: "bg-blue-50/30 dark:bg-blue-950/15",
  }[tint];
  return (
    <div
      title={tooltip}
      className={cn(
        "flex flex-col justify-between rounded-xl border border-zinc-200/60 p-3 dark:border-zinc-800/40",
        tintBg,
      )}
    >
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em] dark:text-zinc-400">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          "mt-2 font-semibold text-xl text-zinc-900 tracking-tight dark:text-zinc-100",
          mono && "font-mono tabular-nums",
        )}
      >
        {value}
      </span>
    </div>
  );
}
