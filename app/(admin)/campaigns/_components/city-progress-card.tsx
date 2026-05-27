"use client";

/**
 * CityProgressCard — one row of the campaign-detail cities list.
 *
 * Visual anatomy (collapsed):
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │░│ Toronto, ON   P1   🟢 healthy        ▾ 4 crawls · in 12d │
 *   │░│ Fri Sep 12 · Crawl 1   [W][M][M][F]                       │
 *   │░│ Sat Sep 13 · Crawl 1   [W][M][M][F]                       │
 *   │░│ Sat Sep 13 · Crawl 2   [W][M][M][F]                       │
 *   │░│ Sun Sep 14 · Crawl 1   [W][M][M][F]                       │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Left border (4px) tone = composite risk (low/medium/high/critical).
 * Pipeline icon = warm-lead supply vs open slots.
 * Click anywhere → navigates to /city-campaigns/[id].
 * Expand button (▾/▴) reveals venue names for non-empty slots.
 */

import type { CityProgressRow } from "@/lib/city-progress";
import { pipelineHealthFor } from "@/lib/city-progress-shared";
import { cn } from "@/lib/cn";
import { ChevronRight, CircleDot, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SlotBar } from "./slot-bar";

interface Props {
  row: CityProgressRow;
}

// Tone palette — kept de-saturated to match the Apple-y aesthetic
// the operator has been requesting elsewhere.
const RISK_BORDER: Record<CityProgressRow["risk"], string> = {
  low: "bg-emerald-500",
  medium: "bg-amber-500",
  high: "bg-rose-500",
  critical: "bg-zinc-900 dark:bg-zinc-100",
};

const PIPELINE_TONE = {
  healthy: "text-emerald-600 dark:text-emerald-400",
  thin: "text-amber-600 dark:text-amber-400",
  weak: "text-rose-600 dark:text-rose-400",
  none: "text-zinc-500 dark:text-zinc-500",
} as const;

const PIPELINE_LABEL = {
  healthy: "Healthy pipeline",
  thin: "Thin pipeline",
  weak: "Weak pipeline",
  none: "No pipeline",
} as const;

export function CityProgressCard({ row }: Props) {
  const [expanded, setExpanded] = useState(false);

  const health = pipelineHealthFor(row);
  const filled = row.pipeline.totalSlots - row.pipeline.openSlots;
  const inDays =
    row.soonestEventDays == null
      ? null
      : row.soonestEventDays < 0
        ? `${Math.abs(row.soonestEventDays)}d ago`
        : row.soonestEventDays === 0
          ? "today"
          : `in ${row.soonestEventDays}d`;

  return (
    <article
      className={cn(
        "card-surface-quiet group/row relative overflow-hidden p-0 transition-colors",
        "hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40",
      )}
    >
      {/* Left risk border */}
      <span
        aria-hidden="true"
        className={cn("absolute top-0 bottom-0 left-0 w-1", RISK_BORDER[row.risk])}
      />

      <div className="flex flex-col gap-2 pr-4 pl-5">
        {/* Top row: city name + meta */}
        <div className="flex items-center justify-between gap-3 pt-3">
          <Link
            href={`/city-campaigns/${row.cityCampaignId}`}
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            <span className="truncate font-medium text-sm">
              {row.cityName}
              {row.cityRegion && (
                <span className="ml-1.5 text-xs text-zinc-500">{row.cityRegion}</span>
              )}
            </span>

            {/* Priority pill */}
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]",
                row.priority === 1
                  ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
              )}
              title={`Priority ${row.priority} (1 = highest)`}
            >
              P{row.priority}
            </span>

            {/* Pipeline-health icon */}
            <span
              className={cn("inline-flex items-center gap-1 text-xs", PIPELINE_TONE[health])}
              title={PIPELINE_LABEL[health]}
            >
              {health === "healthy" ? (
                <Sparkles className="h-3 w-3" />
              ) : health === "none" ? (
                <TriangleAlert className="h-3 w-3" />
              ) : (
                <CircleDot className="h-3 w-3" />
              )}
            </span>
          </Link>

          <div className="flex shrink-0 items-baseline gap-3 font-mono text-[10px] text-zinc-500 tabular-nums">
            <span>
              {filled}/{row.pipeline.totalSlots} filled
            </span>
            {inDays && <span>{inDays}</span>}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-200/60 hover:text-zinc-700 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-300"
              aria-label={expanded ? "Collapse" : "Expand"}
              aria-expanded={expanded}
            >
              <ChevronRight
                className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
              />
            </button>
          </div>
        </div>

        {/* Stacked crawl bars. Each crawl is one row of 4 (or 5) segments. */}
        <div className="flex flex-col gap-1.5 pb-3">
          {row.crawls.length === 0 ? (
            <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-[0.1em]">
              no upcoming crawls
            </p>
          ) : (
            row.crawls.map((crawl) => (
              <SlotBar
                key={crawl.eventId}
                slots={crawl.slots}
                size={expanded ? "md" : "sm"}
                label={
                  expanded
                    ? `${formatCrawlLabel(crawl.eventDate, crawl.dayPart, crawl.crawlNumber)} · ${crawl.daysUntil < 0 ? `${Math.abs(crawl.daysUntil)}d ago` : `in ${crawl.daysUntil}d`}`
                    : undefined
                }
              />
            ))
          )}

          {/* Expanded extras: per-slot venue names */}
          {expanded && row.crawls.length > 0 && (
            <div className="mt-2 grid grid-cols-1 gap-3 border-zinc-200/60 border-t pt-3 sm:grid-cols-2 dark:border-zinc-800/60">
              {row.crawls.map((crawl) => (
                <div key={`detail-${crawl.eventId}`} className="flex flex-col gap-1.5">
                  <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
                    {formatCrawlLabel(crawl.eventDate, crawl.dayPart, crawl.crawlNumber)}
                  </p>
                  <ol className="flex flex-col gap-0.5">
                    {crawl.slots.map((s, i) => (
                      <li
                        key={`${crawl.eventId}-${s.role}-${s.position}-${i}`}
                        className="flex items-baseline justify-between gap-2 text-[11px]"
                      >
                        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                          {s.role === "middle"
                            ? `M${s.position}`
                            : s.role === "wristband"
                              ? "W"
                              : "F"}
                        </span>
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-right",
                            s.state === "empty"
                              ? "text-zinc-400"
                              : "text-zinc-800 dark:text-zinc-200",
                          )}
                        >
                          {s.venueName ?? "—"}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function formatCrawlLabel(
  eventDate: string,
  dayPart: string | null,
  crawlNumber: number | null,
): string {
  // eventDate is YYYY-MM-DD; format as 'Fri Sep 12'
  const d = new Date(`${eventDate}T12:00:00Z`);
  const formatted = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const suffix = crawlNumber && crawlNumber > 1 ? ` · #${crawlNumber}` : "";
  const dpHint = dayPart && dayPart !== "other" ? ` · ${dayPart.replace("_", " ")}` : "";
  return `${formatted}${dpHint}${suffix}`;
}
