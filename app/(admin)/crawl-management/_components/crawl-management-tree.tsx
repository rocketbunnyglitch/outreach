"use client";

/**
 * CrawlManagementTree — city → crawls → venues → deliverable cells.
 *
 * Each city is a collapsible section. Inside each city, crawls
 * render as horizontal rule groups (date + day part + crawl name).
 * Each crawl lists its venues with one column per deliverable type:
 *
 *   Venue row    [social] [staff sheet] [poster] [wristbands] [week of]
 *
 * Deliverable cells are 3-state toggle buttons: pending → done → n/a.
 * Clicking cycles through; the server upserts the
 * crawl_deliverables row.
 *
 * The wristbands column additionally surfaces the linked wristbands
 * table status (pending / ready / shipped / delivered / issue) as a
 * tiny pill above the checkbox, so operators see shipping state at
 * a glance.
 */

import { Card } from "@/components/ui/card";
import { RotChip } from "@/components/ui/rot-chip";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type {
  CrawlMgmtCity,
  CrawlMgmtCrawlRow,
  CrawlMgmtVenueRow,
  DeliverableState,
} from "@/lib/crawl-management-data";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Loader2,
  MinusCircle,
  PackageCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markAllDeliverablesDone, setDeliverableStatus } from "../_actions";

type DeliverableType =
  | "social_media_graphics"
  | "staff_sheet"
  | "participant_poster"
  | "wristbands"
  | "week_of_confirmation";
type DeliverableStatus = "pending" | "done" | "n_a";

const DELIVERABLE_COLUMNS: Array<{ type: DeliverableType; label: string }> = [
  { type: "social_media_graphics", label: "Social media" },
  { type: "staff_sheet", label: "Staff sheet" },
  { type: "participant_poster", label: "Poster" },
  { type: "wristbands", label: "Wristbands" },
  { type: "week_of_confirmation", label: "Week of" },
];

interface Props {
  cities: CrawlMgmtCity[];
}

export function CrawlManagementTree({ cities }: Props) {
  // Track which city sections are open. Default: every city collapsed
  // so the page loads compact; operators expand as they triage.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const expandAll = () => setExpanded(new Set(cities.map((c) => c.cityCampaignId)));
  const collapseAll = () => setExpanded(new Set());

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <button
          type="button"
          onClick={expandAll}
          className="rounded-md border border-zinc-200 px-2 py-0.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={collapseAll}
          className="rounded-md border border-zinc-200 px-2 py-0.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Collapse all
        </button>
      </div>

      {cities.map((city) => (
        <Card key={city.cityCampaignId} className="overflow-hidden p-0">
          <button
            type="button"
            onClick={() => toggle(city.cityCampaignId)}
            className="flex w-full flex-wrap items-center justify-between gap-3 border-zinc-200 border-b px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {expanded.has(city.cityCampaignId) ? (
                <ChevronDown className="h-4 w-4 text-zinc-500" />
              ) : (
                <ChevronRight className="h-4 w-4 text-zinc-500" />
              )}
              <span className="font-semibold text-base">{city.cityName}</span>
              {city.cityRegion && (
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                  {city.cityRegion}
                </span>
              )}
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[10px] text-zinc-600 uppercase tracking-widest dark:bg-zinc-800 dark:text-zinc-400">
                P{city.priority}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500">
                {city.crawls.length} {city.crawls.length === 1 ? "crawl" : "crawls"}
              </span>
              {city.pendingCount > 0 ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[10px] text-amber-800 uppercase tracking-widest dark:bg-amber-950/40 dark:text-amber-300">
                  {city.pendingCount} pending
                </span>
              ) : city.crawls.length > 0 ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[10px] text-emerald-800 uppercase tracking-widest dark:bg-emerald-950/40 dark:text-emerald-300">
                  all set
                </span>
              ) : null}
            </div>
          </button>

          {expanded.has(city.cityCampaignId) && (
            <div className="flex flex-col gap-5 p-4">
              {city.crawls.length === 0 ? (
                <p className="text-sm text-zinc-500">No crawls scheduled in this city yet.</p>
              ) : (
                city.crawls.map((crawl) => <CrawlBlock key={crawl.eventId} crawl={crawl} />)
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function CrawlBlock({ crawl }: { crawl: CrawlMgmtCrawlRow }) {
  const dpLabel = crawl.dayPart?.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) ?? "";
  const title = crawl.crawlName ?? `${dpLabel || "Crawl"} ${crawl.crawlNumber}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between border-zinc-200/60 border-b pb-1.5 dark:border-zinc-800/60">
        <div className="flex items-baseline gap-2">
          <h3 className="font-semibold text-sm">{title}</h3>
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            {crawl.crawlDate}
          </span>
          {crawl.crawlFormat === "day_party" && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] text-amber-800 uppercase tracking-widest dark:bg-amber-950/40 dark:text-amber-300">
              day party
            </span>
          )}
        </div>
      </div>
      {crawl.venues.length === 0 ? (
        <p className="text-xs text-zinc-500">No venues confirmed yet for this crawl.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-zinc-200/60 border-b text-left text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
                <th className="py-1.5 pr-3 font-mono">Venue</th>
                {DELIVERABLE_COLUMNS.map((col) => (
                  <th key={col.type} className="py-1.5 pr-3 font-mono">
                    {col.label}
                  </th>
                ))}
                <th className="py-1.5 pr-3 font-mono" />
              </tr>
            </thead>
            <tbody>
              {crawl.venues.map((v) => (
                <VenueRow key={v.venueEventId} venue={v} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function VenueRow({ venue }: { venue: CrawlMgmtVenueRow }) {
  const router = useRouter();
  const [pending, startTx] = useTransition();
  const toast = useToast();

  function markAllDone() {
    startTx(async () => {
      const r = await markAllDeliverablesDone({ venueEventId: venue.venueEventId });
      if (!r.ok) {
        toast.show({ kind: "error", message: r.error ?? "Couldn't mark all done." });
        return;
      }
      toast.show({ kind: "success", message: `All deliverables done for ${venue.venueName}.` });
      router.refresh();
    });
  }

  return (
    <tr className="border-zinc-200/60 border-b last:border-b-0 dark:border-zinc-800/40">
      <td className="py-2 pr-3">
        <div className="flex flex-col">
          <span className="font-medium text-sm">{venue.venueName}</span>
          <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
            {venue.role ?? "—"}
          </span>
        </div>
      </td>
      {DELIVERABLE_COLUMNS.map((col) => (
        <td key={col.type} className="py-2 pr-3">
          <DeliverableCell
            venueEventId={venue.venueEventId}
            type={col.type}
            state={venue.deliverables[col.type]}
            wristbandStatus={col.type === "wristbands" ? venue.wristbandStatus : null}
            isWristbandRole={venue.role === "wristband"}
          />
        </td>
      ))}
      <td className="py-2 pr-3 text-right">
        <button
          type="button"
          onClick={markAllDone}
          disabled={pending}
          title="Mark every deliverable for this venue as done"
          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[9px] text-emerald-800 uppercase tracking-widest hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
        >
          {pending ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <PackageCheck className="h-2.5 w-2.5" />
          )}
          All done
        </button>
      </td>
    </tr>
  );
}

function DeliverableCell({
  venueEventId,
  type,
  state,
  wristbandStatus,
  isWristbandRole,
}: {
  venueEventId: string;
  type: DeliverableType;
  state: DeliverableState;
  wristbandStatus: CrawlMgmtVenueRow["wristbandStatus"];
  isWristbandRole: boolean;
}) {
  const router = useRouter();
  const [pending, startTx] = useTransition();
  const toast = useToast();

  // Tri-state cycle: pending -> done -> n/a -> pending.
  const next: Record<DeliverableStatus, DeliverableStatus> = {
    pending: "done",
    done: "n_a",
    n_a: "pending",
  };

  function flip() {
    startTx(async () => {
      const r = await setDeliverableStatus({
        venueEventId,
        deliverableType: type,
        status: next[state.status],
      });
      if (!r.ok) {
        toast.show({ kind: "error", message: r.error ?? "Couldn't save." });
        return;
      }
      router.refresh();
    });
  }

  // Wristband column gets a small status pill above the checkbox when
  // the venue is a wristband role. Non-wristband-role venues skip the
  // pill entirely (the deliverable still toggles for "we sent the
  // wristbands handoff materials" tracking).
  const wristbandPill =
    type === "wristbands" && isWristbandRole && wristbandStatus ? (
      <span
        className={cn(
          "mb-1 inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-widest",
          wristbandStatus === "delivered"
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            : wristbandStatus === "shipped"
              ? "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
              : wristbandStatus === "ready_to_ship"
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                : wristbandStatus === "issue"
                  ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                  : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        )}
      >
        {wristbandStatus.replace(/_/g, " ")}
      </span>
    ) : null;

  return (
    <div className="flex flex-col items-start">
      {wristbandPill}
      <button
        type="button"
        onClick={flip}
        disabled={pending}
        title={`${state.status} — click to mark ${next[state.status]}`}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-md border px-2 font-mono text-[10px] transition-colors disabled:opacity-50",
          state.status === "done"
            ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
            : state.status === "n_a"
              ? "border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500"
              : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300",
        )}
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : state.status === "done" ? (
          <Check className="h-3 w-3" />
        ) : state.status === "n_a" ? (
          <MinusCircle className="h-3 w-3" />
        ) : (
          <CircleDashed className="h-3 w-3" />
        )}
        {state.status === "done" ? "Done" : state.status === "n_a" ? "N/A" : "Pending"}
      </button>
      {state.status === "pending" && state.pendingAgeHours != null && (
        <RotChip kind="pending_deliverable" ageHours={state.pendingAgeHours} className="mt-1" />
      )}
    </div>
  );
}
