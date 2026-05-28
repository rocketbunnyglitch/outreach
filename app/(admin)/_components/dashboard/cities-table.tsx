"use client";

import { cn } from "@/lib/cn";
import { Calendar, ChevronRight, ExternalLink, Target } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Sparkline } from "./sparkline";

/** Aggregated data for one city. */
export interface CityRow {
  cityId: string;
  cityName: string;
  cityRegion: string | null;
  countryName: string;
  /** All city-campaigns in this city. */
  campaigns: CampaignRow[];
  /** Total sales summed across all city-campaigns in this city. */
  totalSalesCents: number;
  totalGoalCents: number;
  /** Total tickets sold across all events in this city. Operational primary. */
  totalTicketsSold: number;
  /** Total venues confirmed across all events. */
  venuesConfirmed: number;
  /** Sum of target_venue_count across this city's city_campaigns. */
  venuesTargeted: number;
  /** Daily outreach activity for the last 30 days, oldest to newest. */
  outreach30d: number[];
  /** "active" if any campaign in the city is active/confirmed, else "planning"
   *  or "cancelled" if all are cancelled. */
  rollupStatus: "active" | "planning" | "confirmed" | "cancelled";
}

/** A campaign within a city, with its events. */
export interface CampaignRow {
  cityCampaignId: string;
  campaignName: string;
  campaignSlug: string;
  status: "planning" | "active" | "confirmed" | "cancelled";
  salesCents: number;
  goalCents: number;
  /** Sum of ticket_sales_count across this city-campaign's events. */
  ticketsSold: number;
  venuesConfirmed: number;
  venuesTargeted: number;
  events: EventRow[];
}

/** An event within a campaign. */
export interface EventRow {
  eventId: string;
  eventDate: string;
  slotNumber: number;
  /** Halloween-aware: 'Friday Night #2' label fragment. Null for legacy events. */
  dayPart:
    | "thursday_night"
    | "friday_night"
    | "saturday_day"
    | "saturday_night"
    | "sunday_day"
    | "sunday_night"
    | "other"
    | null;
  crawlNumber: number | null;
  ticketSalesCount: number;
  routeLabel: string | null;
  status: "planned" | "confirmed" | "completed" | "cancelled";
  venuesLinked: number;
  venuesRequired: number;
  wristbandFilled: number;
  middleFilled: number;
  finalFilled: number;
  wristbandRequired: number;
  middleRequired: number;
  finalRequired: number;
}

interface Props {
  cities: CityRow[];
  /**
   * When the operator has scoped the dashboard to one campaign, we pass
   * it here so the empty state can read "no cities in {Campaign} yet"
   * instead of the misleading "no active campaigns yet" — which fires
   * the moment they create a brand-new campaign that hasn't had cities
   * added to it.
   */
  currentCampaign?: { id: string; name: string } | null;
}

type SortKey = "name" | "status" | "sales" | "venues" | "events" | "outreach";

const STATUS_SORT_ORDER: Record<CityRow["rollupStatus"], number> = {
  active: 0,
  confirmed: 1,
  planning: 2,
  cancelled: 3,
};

function cityEventCount(c: CityRow): number {
  return c.campaigns.reduce((sum, camp) => sum + camp.events.length, 0);
}

function compareCities(a: CityRow, b: CityRow, key: SortKey): number {
  switch (key) {
    case "name":
      return a.cityName.localeCompare(b.cityName);
    case "status":
      return STATUS_SORT_ORDER[a.rollupStatus] - STATUS_SORT_ORDER[b.rollupStatus];
    case "sales":
      return a.totalSalesCents - b.totalSalesCents;
    case "venues":
      return a.venuesConfirmed - b.venuesConfirmed;
    case "events":
      return cityEventCount(a) - cityEventCount(b);
    case "outreach":
      return a.outreach30d.reduce((s, n) => s + n, 0) - b.outreach30d.reduce((s, n) => s + n, 0);
  }
}

function SortTh({
  label,
  sortKey,
  active,
  dir,
  onSort,
  span,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  span: string;
  align?: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        span,
        "flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest transition-colors hover:text-zinc-800 dark:hover:text-zinc-200",
        active ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-500",
        align === "right" && "justify-end",
      )}
    >
      <span>{label}</span>
      <span aria-hidden className={cn("text-[9px]", !active && "opacity-30")}>
        {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </button>
  );
}

/**
 * Main dashboard table. Each row = one city. Click a row to expand and see
 * the campaigns + events running there.
 *
 * Visual model: alternating dark/darker rows à la financial trading tables.
 * Numerical columns use tabular-nums + Geist Mono for clean alignment.
 */
export function CitiesTable({ cities, currentCampaign }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Auto-expand the first city if there's only a few, so the dashboard
    // doesn't look empty on first load.
    return cities.length > 0 && cities.length <= 3 ? new Set([cities[0]?.cityId ?? ""]) : new Set();
  });

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? cities.filter(
          (c) =>
            c.cityName.toLowerCase().includes(q) ||
            (c.cityRegion ?? "").toLowerCase().includes(q) ||
            c.countryName.toLowerCase().includes(q),
        )
      : cities;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => compareCities(a, b, sort.key) * dir);
  }, [cities, query, sort]);

  if (cities.length === 0) {
    // Distinguish "no campaigns at all" from "this campaign has no
    // cities yet" — the second case is what you see right after
    // creating a campaign and lands the operator on a misleading
    // "no campaigns yet" message.
    if (currentCampaign) {
      return (
        <div className="card-surface border-dashed p-12 text-center">
          <Target className="mx-auto h-8 w-8 text-zinc-400" />
          <h3 className="mt-4 font-semibold text-2xl tracking-tight ">
            No cities in {currentCampaign.name} yet
          </h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Add cities to this campaign and they'll appear here with live sales + venue progress.
          </p>
          <Link
            href={`/campaigns/${currentCampaign.id}`}
            className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 font-medium text-sm text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Open {currentCampaign.name} →
          </Link>
        </div>
      );
    }
    return (
      <div className="card-surface border-dashed p-12 text-center">
        <Target className="mx-auto h-8 w-8 text-zinc-400" />
        <h3 className="mt-4 font-semibold text-2xl tracking-tight ">No active campaigns yet</h3>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Create a campaign and add cities to it, and they'll appear here with live sales + venue
          progress.
        </p>
        <Link
          href="/campaigns/new"
          className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 font-medium text-sm text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Create your first campaign
        </Link>
      </div>
    );
  }

  return (
    <div className="card-surface overflow-hidden">
      {/* Filter */}
      <div className="flex items-center gap-3 border-zinc-200 border-b px-4 py-2.5 dark:border-zinc-800">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter cities…"
          className="w-full max-w-xs rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        {query && (
          <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
            {visible.length} {visible.length === 1 ? "match" : "matches"}
          </span>
        )}
      </div>

      {/* Horizontal scroll on mobile so all columns stay readable instead of
          crushing — the min-width keeps the grid from collapsing. */}
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          {/* Column header — click to sort */}
          <div className="grid grid-cols-12 gap-3 border-zinc-200 border-b bg-zinc-100 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
            <SortTh
              label="City"
              sortKey="name"
              span="col-span-3"
              active={sort.key === "name"}
              dir={sort.dir}
              onSort={toggleSort}
            />
            <SortTh
              label="Status"
              sortKey="status"
              span="col-span-2"
              active={sort.key === "status"}
              dir={sort.dir}
              onSort={toggleSort}
            />
            <SortTh
              label="Sales"
              sortKey="sales"
              span="col-span-2"
              align="right"
              active={sort.key === "sales"}
              dir={sort.dir}
              onSort={toggleSort}
            />
            <SortTh
              label="Venues"
              sortKey="venues"
              span="col-span-2"
              align="right"
              active={sort.key === "venues"}
              dir={sort.dir}
              onSort={toggleSort}
            />
            <SortTh
              label="Events"
              sortKey="events"
              span="col-span-1"
              align="right"
              active={sort.key === "events"}
              dir={sort.dir}
              onSort={toggleSort}
            />
            <SortTh
              label="Last 30d"
              sortKey="outreach"
              span="col-span-2"
              align="right"
              active={sort.key === "outreach"}
              dir={sort.dir}
              onSort={toggleSort}
            />
          </div>

          {/* Rows */}
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {visible.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-zinc-500">
                No cities match “{query}”.
              </p>
            ) : (
              visible.map((city, idx) => (
                <div key={city.cityId}>
                  <CityHeaderRow
                    city={city}
                    isExpanded={expanded.has(city.cityId)}
                    onClick={() => toggle(city.cityId)}
                    striped={idx % 2 === 1}
                  />
                  {expanded.has(city.cityId) && (
                    <CityExpandedContent city={city} striped={idx % 2 === 1} />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CityHeaderRow({
  city,
  isExpanded,
  onClick,
  striped,
}: {
  city: CityRow;
  isExpanded: boolean;
  onClick: () => void;
  striped: boolean;
}) {
  const salesPct =
    city.totalGoalCents > 0 ? Math.round((city.totalSalesCents / city.totalGoalCents) * 100) : 0;
  const venuesPct =
    city.venuesTargeted > 0 ? Math.round((city.venuesConfirmed / city.venuesTargeted) * 100) : 0;
  const totalEvents = city.campaigns.reduce((sum, c) => sum + c.events.length, 0);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-12 items-center gap-3 px-4 py-3.5 text-left transition-colors",
        striped ? "bg-zinc-50/50 dark:bg-white/[0.02]" : "bg-white dark:bg-transparent",
        "hover:bg-zinc-100 dark:hover:bg-zinc-900",
      )}
      aria-expanded={isExpanded}
    >
      {/* City + region */}
      <div className="col-span-3 flex min-w-0 items-center gap-2">
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform",
            isExpanded && "rotate-90",
          )}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{city.cityName}</span>
          <span className="truncate text-[11px] text-zinc-500">
            {city.cityRegion ? `${city.cityRegion} · ` : ""}
            {city.countryName} · {city.campaigns.length}{" "}
            {city.campaigns.length === 1 ? "campaign" : "campaigns"}
          </span>
        </div>
      </div>

      {/* Status */}
      <div className="col-span-2">
        <StatusBadge status={city.rollupStatus} />
      </div>

      {/* Sales */}
      <div className="col-span-2 text-right">
        <p className="font-medium font-mono text-sm tabular-nums">
          {formatCurrency(city.totalSalesCents)}
        </p>
        {city.totalGoalCents > 0 && (
          <p className="font-mono text-[10px] text-zinc-500 tabular-nums">
            of {formatCurrency(city.totalGoalCents)}{" "}
            <span
              className={
                salesPct >= 80
                  ? "text-emerald-500"
                  : salesPct >= 40
                    ? "text-amber-500"
                    : "text-zinc-500"
              }
            >
              {salesPct}%
            </span>
          </p>
        )}
      </div>

      {/* Venues */}
      <div className="col-span-2 text-right">
        <p className="font-medium font-mono text-sm tabular-nums">
          {city.venuesConfirmed}
          <span className="text-zinc-500">/{city.venuesTargeted}</span>
        </p>
        {city.venuesTargeted > 0 && (
          <p className="font-mono text-[10px] text-zinc-500 tabular-nums">
            <span
              className={
                venuesPct >= 80
                  ? "text-emerald-500"
                  : venuesPct >= 40
                    ? "text-amber-500"
                    : "text-zinc-500"
              }
            >
              {venuesPct}%
            </span>{" "}
            confirmed
          </p>
        )}
      </div>

      {/* Events count */}
      <div className="col-span-1 text-right font-mono text-sm tabular-nums">{totalEvents}</div>

      {/* Sparkline */}
      <div className="col-span-2 flex justify-end">
        <Sparkline
          values={city.outreach30d}
          colorClass={city.outreach30d.some((v) => v > 0) ? "text-emerald-500" : "text-zinc-600"}
          width={100}
          showEndDot={city.outreach30d.some((v) => v > 0)}
          label={`${city.cityName} outreach trend`}
        />
      </div>
    </button>
  );
}

function CityExpandedContent({
  city,
  striped,
}: {
  city: CityRow;
  striped: boolean;
}) {
  return (
    <div
      className={cn(
        "border-zinc-200 border-t border-dashed px-4 py-4 dark:border-zinc-800/50",
        striped ? "bg-zinc-50/30 dark:bg-white/[0.01]" : "bg-zinc-50/50 dark:bg-white/[0.025]",
      )}
    >
      <div className="space-y-5 border-zinc-200 border-l pl-6 dark:border-zinc-800">
        {city.campaigns.length === 0 && (
          <p className="text-sm text-zinc-500 italic">No campaigns in this city yet.</p>
        )}
        {city.campaigns.map((campaign) => (
          <CampaignBlock key={campaign.cityCampaignId} campaign={campaign} />
        ))}
      </div>
    </div>
  );
}

function CampaignBlock({ campaign }: { campaign: CampaignRow }) {
  const salesPct =
    campaign.goalCents > 0 ? Math.round((campaign.salesCents / campaign.goalCents) * 100) : 0;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <Link
            href={`/city-campaigns/${campaign.cityCampaignId}`}
            className="font-medium text-sm hover:underline"
          >
            {campaign.campaignName}
          </Link>
          <StatusBadge status={campaign.status} />
        </div>
        <div className="flex items-baseline gap-4 font-mono text-[11px] text-zinc-500 tabular-nums">
          <span>
            <Target className="-mt-0.5 mr-1 inline h-3 w-3" />
            {campaign.venuesConfirmed}/{campaign.venuesTargeted} venues
          </span>
          {campaign.goalCents > 0 && (
            <span>
              {formatCurrency(campaign.salesCents)}/{formatCurrency(campaign.goalCents)}{" "}
              <span
                className={
                  salesPct >= 80 ? "text-emerald-500" : salesPct >= 40 ? "text-amber-500" : ""
                }
              >
                ({salesPct}%)
              </span>
            </span>
          )}
        </div>
      </div>

      {campaign.events.length === 0 ? (
        <p className="pl-4 text-xs text-zinc-500 italic">
          No events scheduled.{" "}
          <Link
            href={`/city-campaigns/${campaign.cityCampaignId}`}
            className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Add one
          </Link>
        </p>
      ) : (
        <ul className="space-y-1">
          {campaign.events.map((event) => (
            <EventRowLine key={event.eventId} event={event} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EventRowLine({ event }: { event: EventRow }) {
  const isUnderstaffed = event.venuesLinked < event.venuesRequired;
  const roleBreakdown = `${event.wristbandFilled}/${event.wristbandRequired} W · ${event.middleFilled}/${event.middleRequired} M · ${event.finalFilled}/${event.finalRequired} F`;

  // Friendly daypart label, e.g. "Friday Night #2"
  const crawlLabel = event.dayPart
    ? `${dayPartShort(event.dayPart)}${event.crawlNumber ? ` #${event.crawlNumber}` : ""}`
    : null;

  return (
    <li>
      <Link
        href={`/events/${event.eventId}`}
        className="grid grid-cols-12 items-center gap-3 rounded px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        <div className="col-span-3 flex items-center gap-2">
          <Calendar className="h-3 w-3 text-zinc-500" />
          <span className="font-mono tabular-nums">{formatDate(event.eventDate)}</span>
          {crawlLabel ? (
            <span className="font-mono text-[10px] text-zinc-700 dark:text-zinc-300">
              {crawlLabel}
            </span>
          ) : event.slotNumber > 1 ? (
            <span className="font-mono text-[10px] text-zinc-500">slot {event.slotNumber}</span>
          ) : null}
        </div>
        <div className="col-span-2">
          <StatusBadge status={event.status} compact />
        </div>
        <div className="col-span-2 font-mono text-zinc-500 tabular-nums">
          {event.venuesLinked}/{event.venuesRequired} venues
          {isUnderstaffed && <span className="ml-2 text-amber-500">⚠</span>}
        </div>
        <div className="col-span-2 font-mono text-[10px] text-zinc-500 tabular-nums">
          {roleBreakdown}
        </div>
        <div className="col-span-2 text-right font-mono tabular-nums">
          {event.ticketSalesCount > 0 ? (
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {event.ticketSalesCount.toLocaleString()}
              <span className="ml-1 font-normal text-[10px] text-zinc-500">tix</span>
            </span>
          ) : (
            <span className="text-[10px] text-zinc-500">— tix</span>
          )}
        </div>
        <div className="col-span-1 text-right">
          <ExternalLink className="inline h-3 w-3 text-zinc-500" />
        </div>
      </Link>
    </li>
  );
}

/**
 * Compact daypart label for dashboard rows.
 * 'friday_night' → 'Fri Night'
 */
function dayPartShort(dp: NonNullable<EventRow["dayPart"]>): string {
  switch (dp) {
    case "thursday_night":
      return "Thu Night";
    case "friday_night":
      return "Fri Night";
    case "saturday_day":
      return "Sat Day";
    case "saturday_night":
      return "Sat Night";
    case "sunday_day":
      return "Sun Day";
    case "sunday_night":
      return "Sun Night";
    case "other":
      return "Other";
  }
}

function StatusBadge({
  status,
  compact = false,
}: {
  status: string;
  compact?: boolean;
}) {
  const colors: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20",
    confirmed: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20",
    completed: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20",
    planning: "bg-blue-500/10 text-blue-500 ring-blue-500/20",
    planned: "bg-blue-500/10 text-blue-500 ring-blue-500/20",
    cancelled: "bg-rose-500/10 text-rose-500 ring-rose-500/20",
  };
  const color = colors[status] ?? colors.planning;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-mono uppercase tracking-wider ring-1 ring-inset",
        compact ? "px-1.5 py-0 text-[9px]" : "px-2 py-0.5 text-[10px]",
        color,
      )}
    >
      {status}
    </span>
  );
}

// --- Formatters ---------------------------------------------------------

function formatCurrency(cents: number): string {
  if (cents === 0) return "$0";
  const dollars = cents / 100;
  if (dollars >= 1_000_000) {
    return `$${(dollars / 1_000_000).toFixed(1)}M`;
  }
  if (dollars >= 1000) {
    return `$${(dollars / 1000).toFixed(1)}k`;
  }
  return `$${dollars.toFixed(0)}`;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
