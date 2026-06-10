"use client";

/**
 * Crawl overlap timeline ("gantt") for /crawl-support (scaffold, operator
 * request 2026-06-10): one row per city, a block per crawl positioned on a
 * shared date axis so overlapping nights are visible at a glance.
 * Interactive basics: hover shows the crawl label + date, click opens the
 * crawl's detail page. All date math + labels are precomputed server-side
 * (lib/crawl-gantt.ts) so this renders hydration-safe.
 */

import Link from "next/link";
import { useState } from "react";

export interface GanttItem {
  eventId: string;
  label: string;
  dateLabel: string;
  /** 0-100, position on the shared axis. */
  offsetPct: number;
}

export interface GanttRow {
  cityName: string;
  items: GanttItem[];
}

export interface GanttAxisTick {
  label: string;
  offsetPct: number;
}

export function CrawlGantt({
  rows,
  ticks,
  rangeLabel,
}: {
  rows: GanttRow[];
  ticks: GanttAxisTick[];
  rangeLabel: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  if (rows.length === 0) return null;

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <h2 className="font-semibold text-sm tracking-tight">Crawl timeline</h2>
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
          {rangeLabel}
        </span>
      </header>
      <div className="overflow-x-auto px-5 py-4">
        <div className="min-w-[640px]">
          {/* Axis */}
          <div className="relative mb-2 ml-32 h-4">
            {ticks.map((t) => (
              <span
                key={t.label}
                className="-translate-x-1/2 absolute top-0 font-mono text-[9px] text-zinc-400 uppercase"
                style={{ left: `${t.offsetPct}%` }}
              >
                {t.label}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <div key={row.cityName} className="flex items-center gap-2">
                <span className="w-30 shrink-0 truncate text-right font-mono text-[10px] text-zinc-500 uppercase tracking-[0.06em]">
                  {row.cityName}
                </span>
                <div className="relative h-5 flex-1 rounded bg-zinc-100/60 dark:bg-zinc-900/60">
                  {ticks.map((t) => (
                    <span
                      key={t.label}
                      className="absolute top-0 bottom-0 w-px bg-zinc-200/70 dark:bg-zinc-800/70"
                      style={{ left: `${t.offsetPct}%` }}
                    />
                  ))}
                  {row.items.map((item) => (
                    <Link
                      key={item.eventId}
                      href={`/events/${item.eventId}`}
                      title={`${item.label} · ${item.dateLabel}`}
                      onMouseEnter={() => setHovered(item.eventId)}
                      onMouseLeave={() => setHovered(null)}
                      className={`-translate-x-1/2 absolute top-0.5 bottom-0.5 w-2.5 rounded-sm transition-transform ${
                        hovered === item.eventId
                          ? "z-10 scale-125 bg-emerald-500"
                          : "bg-emerald-600/70 hover:bg-emerald-500 dark:bg-emerald-500/60"
                      }`}
                      style={{ left: `${item.offsetPct}%` }}
                    >
                      <span className="sr-only">
                        {item.label} {item.dateLabel}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {hovered && (
            <p className="mt-2 font-mono text-[10px] text-zinc-500">
              {rows.flatMap((r) => r.items).find((i) => i.eventId === hovered)?.label} ·{" "}
              {rows.flatMap((r) => r.items).find((i) => i.eventId === hovered)?.dateLabel} — click
              to open
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
