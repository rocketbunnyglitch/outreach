"use client";

/**
 * Crawl-night grid for /crawl-support (v2, operator request 2026-06-11:
 * "specify the days and if there are any gaps... each crawl is mapped
 * out and I can see overlap").
 *
 * One COLUMN per distinct crawl night, one ROW per city, a clickable
 * chip per crawl (hover for the full name, click to open the crawl).
 * Dark stretches collapse into a narrow hatched column and are listed
 * under the grid so the operator knows which nights need no support.
 * The bottom "crawls / night" row makes overlap explicit — 2+ crawls
 * on the same night lights up amber.
 *
 * All date math + labels are precomputed server-side (lib/crawl-gantt.ts)
 * so this renders hydration-safe.
 */

import { cn } from "@/lib/cn";
import { MoonStar } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export interface GanttCell {
  eventId: string;
  /** Short in-grid label, e.g. "Fri #2". */
  chip: string;
  /** Full hover label, e.g. "friday night 2 · Chicago · Fri, Oct 30". */
  title: string;
}

export interface GanttColumn {
  /** Stable render key (dateIso for crawl nights, "gap-<iso>" for gaps). */
  key: string;
  /** ISO yyyy-mm-dd for crawl nights; null for a collapsed dark stretch. */
  dateIso: string | null;
  /** "Thu, Oct 29" for crawl nights; "3 dark nights" for gaps. */
  label: string;
  isGap: boolean;
  /** Crawls across all cities that night (0 for gaps). */
  totalCrawls: number;
}

export interface GanttRow {
  cityName: string;
  /** Parallel to columns: cells[i] = this city's crawls in column i. */
  cells: GanttCell[][];
}

export function CrawlGantt({
  columns,
  rows,
  rangeLabel,
  gapSummary,
  crawlNights,
  gapNights,
}: {
  columns: GanttColumn[];
  rows: GanttRow[];
  rangeLabel: string;
  gapSummary: string;
  crawlNights: number;
  gapNights: number;
}) {
  const [hovered, setHovered] = useState<GanttCell | null>(null);
  if (rows.length === 0 || columns.length === 0) return null;

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <h2 className="font-semibold text-sm tracking-tight">Crawl nights</h2>
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
          {rangeLabel} · {crawlNights} crawl {crawlNights === 1 ? "night" : "nights"}
          {gapNights > 0 && ` · ${gapNights} dark ${gapNights === 1 ? "night" : "nights"}`}
        </span>
      </header>

      <div className="overflow-x-auto px-5 py-4">
        <table className="border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="min-w-28 border-zinc-200/60 border-b pr-3 pb-2 dark:border-zinc-800/40" />
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "border-zinc-200/60 border-b px-2 pb-2 text-center align-bottom dark:border-zinc-800/40",
                    col.isGap ? "min-w-16" : "min-w-24",
                  )}
                >
                  {col.isGap ? (
                    <span className="inline-flex items-center gap-1 font-mono text-[9px] text-zinc-400 uppercase tracking-[0.06em]">
                      <MoonStar className="h-2.5 w-2.5" />
                      {col.label}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-[0.06em] dark:text-zinc-300">
                      {col.label}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.cityName}>
                <th
                  scope="row"
                  className="whitespace-nowrap border-zinc-200/40 border-b py-1.5 pr-3 text-right font-mono font-normal text-[10px] text-zinc-500 uppercase tracking-[0.06em] dark:border-zinc-800/30"
                >
                  {row.cityName}
                </th>
                {columns.map((col, i) => {
                  const cell = row.cells[i] ?? [];
                  return (
                    <td
                      key={col.key}
                      className={cn(
                        "border-zinc-200/40 border-b px-1.5 py-1.5 text-center align-middle dark:border-zinc-800/30",
                        col.isGap && "bg-zinc-100/50 dark:bg-zinc-900/50",
                      )}
                    >
                      {cell.length > 0 && (
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          {cell.map((item) => (
                            <Link
                              key={item.eventId}
                              href={`/events/${item.eventId}`}
                              title={`${item.title} — click to open`}
                              onMouseEnter={() => setHovered(item)}
                              onMouseLeave={() => setHovered(null)}
                              className={cn(
                                "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-medium font-mono text-[10px] uppercase tracking-[0.04em] ring-1 ring-inset transition-colors",
                                hovered?.eventId === item.eventId
                                  ? "bg-emerald-500/30 text-emerald-800 ring-emerald-500/50 dark:text-emerald-200"
                                  : "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 hover:bg-emerald-500/25 dark:text-emerald-300",
                              )}
                            >
                              {item.chip}
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* Overlap row — how many crawls run simultaneously each
                night. 2+ means staff support is split across cities. */}
            <tr>
              <th
                scope="row"
                className="whitespace-nowrap py-1.5 pr-3 text-right font-mono font-normal text-[9px] text-zinc-400 uppercase tracking-[0.06em]"
              >
                crawls / night
              </th>
              {columns.map((col) => (
                <td key={col.key} className="px-1.5 py-1.5 text-center">
                  {col.isGap ? (
                    <span className="font-mono text-[9px] text-zinc-300 dark:text-zinc-700">—</span>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ring-1 ring-inset",
                        col.totalCrawls >= 2
                          ? "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300"
                          : "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300",
                      )}
                      title={
                        col.totalCrawls >= 2
                          ? `${col.totalCrawls} crawls overlap this night — support is split across cities`
                          : "1 crawl this night"
                      }
                    >
                      {col.totalCrawls}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        {hovered && (
          <p className="mt-2 font-mono text-[10px] text-zinc-500">
            {hovered.title} — click to open
          </p>
        )}

        <p className="mt-3 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
          {gapNights > 0 ? (
            <>
              <MoonStar className="mr-1 inline-block h-2.5 w-2.5 text-zinc-400" />
              Dark nights (no support needed): {gapSummary}
            </>
          ) : (
            "No dark nights — every night in the range has a crawl."
          )}
        </p>
      </div>
    </section>
  );
}
