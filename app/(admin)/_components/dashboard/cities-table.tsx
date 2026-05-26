"use client";

import { cn } from "@/lib/cn";
import { Calendar, ChevronRight, ExternalLink, Target } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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
  venuesConfirmed: number;
  venuesTargeted: number;
  events: EventRow[];
}

/** An event within a campaign. */
export interface EventRow {
  eventId: string;
  eventDate: string;
  slotNumber: number;
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
}

/**
 * Main dashboard table. Each row = one city. Click a row to expand and see
 * the campaigns + events running there.
 *
 * Visual model: alternating dark/darker rows à la financial trading tables.
 * Numerical columns use tabular-nums + Geist Mono for clean alignment.
 */
export function CitiesTable({ cities }: Props) {
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

  if (cities.length === 0) {
    return (
      <div className="rounded-lg border border-stone-200 border-dashed bg-white p-12 text-center dark:border-stone-800 dark:bg-stone-950">
        <Target className="mx-auto h-8 w-8 text-stone-400" />
        <h3 className="mt-4 font-semibold text-2xl tracking-tight ">No active campaigns yet</h3>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          Create a campaign and add cities to it, and they'll appear here with live sales + venue
          progress.
        </p>
        <Link
          href="/campaigns/new"
          className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-4 py-2 font-medium text-sm text-stone-50 hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
        >
          Create your first campaign
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
      {/* Column header */}
      <div className="grid grid-cols-12 gap-3 border-stone-200 border-b bg-stone-100 px-4 py-2.5 font-mono text-[10px] text-stone-500 uppercase tracking-widest dark:border-stone-800 dark:bg-stone-900">
        <div className="col-span-3">City</div>
        <div className="col-span-2">Status</div>
        <div className="col-span-2 text-right">Sales</div>
        <div className="col-span-2 text-right">Venues</div>
        <div className="col-span-1 text-right">Events</div>
        <div className="col-span-2 text-right">Last 30d</div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-stone-200 dark:divide-stone-800">
        {cities.map((city, idx) => (
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
        ))}
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
        striped ? "bg-stone-50/50 dark:bg-stone-950" : "bg-white dark:bg-stone-950/40",
        "hover:bg-stone-100 dark:hover:bg-stone-900",
      )}
      aria-expanded={isExpanded}
    >
      {/* City + region */}
      <div className="col-span-3 flex min-w-0 items-center gap-2">
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-stone-500 transition-transform",
            isExpanded && "rotate-90",
          )}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{city.cityName}</span>
          <span className="truncate text-[11px] text-stone-500">
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
          <p className="font-mono text-[10px] text-stone-500 tabular-nums">
            of {formatCurrency(city.totalGoalCents)}{" "}
            <span
              className={
                salesPct >= 80
                  ? "text-emerald-500"
                  : salesPct >= 40
                    ? "text-amber-500"
                    : "text-stone-500"
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
          <span className="text-stone-500">/{city.venuesTargeted}</span>
        </p>
        {city.venuesTargeted > 0 && (
          <p className="font-mono text-[10px] text-stone-500 tabular-nums">
            <span
              className={
                venuesPct >= 80
                  ? "text-emerald-500"
                  : venuesPct >= 40
                    ? "text-amber-500"
                    : "text-stone-500"
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
          colorClass={city.outreach30d.some((v) => v > 0) ? "text-emerald-500" : "text-stone-600"}
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
        "border-stone-200 border-t border-dashed px-4 py-4 dark:border-stone-800/50",
        striped ? "bg-stone-50/30 dark:bg-stone-950" : "bg-stone-50/50 dark:bg-stone-950/60",
      )}
    >
      <div className="space-y-5 border-stone-200 border-l pl-6 dark:border-stone-800">
        {city.campaigns.length === 0 && (
          <p className="text-sm text-stone-500 italic">No campaigns in this city yet.</p>
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
        <div className="flex items-baseline gap-4 font-mono text-[11px] text-stone-500 tabular-nums">
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
        <p className="pl-4 text-stone-500 text-xs italic">
          No events scheduled.{" "}
          <Link
            href={`/city-campaigns/${campaign.cityCampaignId}`}
            className="underline hover:text-stone-700 dark:hover:text-stone-300"
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

  return (
    <li>
      <Link
        href={`/events/${event.eventId}`}
        className="grid grid-cols-12 items-center gap-3 rounded px-3 py-1.5 text-xs hover:bg-stone-100 dark:hover:bg-stone-900"
      >
        <div className="col-span-3 flex items-center gap-2">
          <Calendar className="h-3 w-3 text-stone-500" />
          <span className="font-mono tabular-nums">{formatDate(event.eventDate)}</span>
          {event.slotNumber > 1 && (
            <span className="font-mono text-[10px] text-stone-500">slot {event.slotNumber}</span>
          )}
        </div>
        <div className="col-span-2">
          <StatusBadge status={event.status} compact />
        </div>
        <div className="col-span-3 font-mono text-stone-500 tabular-nums">
          {event.venuesLinked}/{event.venuesRequired} venues
          {isUnderstaffed && <span className="ml-2 text-amber-500">⚠</span>}
        </div>
        <div className="col-span-3 font-mono text-[10px] text-stone-500 tabular-nums">
          {roleBreakdown}
        </div>
        <div className="col-span-1 text-right">
          <ExternalLink className="inline h-3 w-3 text-stone-500" />
        </div>
      </Link>
    </li>
  );
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
    completed: "bg-stone-500/10 text-stone-400 ring-stone-500/20",
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
