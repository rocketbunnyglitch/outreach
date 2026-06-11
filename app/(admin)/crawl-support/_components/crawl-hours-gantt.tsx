"use client";

/**
 * Interactive, horizontally-scrollable HOURS gantt for /crawl-support.
 *
 * One crawl at a time (picker + prev/next), one row per venue slot,
 * bars positioned on a real time axis (evening through past-midnight).
 * Confirmed bars are solid (colored by role), pending bars hatched.
 * Red translucent spans mark holes in CONFIRMED coverage. Hover any
 * bar for the exact hours + data source; click to open the crawl.
 * Confirmed venues with no usable times are listed below the chart so
 * the missing work stays visible.
 */

import type { HoursGanttBar, HoursGanttCrawl } from "@/lib/crawl-hours-gantt";
import { ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

const PX_PER_MIN = 1.6;
const ROW_H = 34;

const ROLE_BAR: Record<string, string> = {
  wristband: "bg-amber-500/80 ring-amber-600/50",
  middle: "bg-blue-500/75 ring-blue-600/50",
  final: "bg-violet-500/75 ring-violet-600/50",
  alt_final: "bg-zinc-500/70 ring-zinc-600/50",
};

const ROLE_LABEL: Record<string, string> = {
  wristband: "Wristband",
  middle: "Middle",
  final: "Final",
  alt_final: "Alt final",
};

export function CrawlHoursGantt({ crawls }: { crawls: HoursGanttCrawl[] }) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState<HoursGanttBar | null>(null);
  const crawl = crawls[Math.min(index, Math.max(0, crawls.length - 1))];

  const width = useMemo(
    () => (crawl ? (crawl.axisEndMin - crawl.axisStartMin) * PX_PER_MIN : 0),
    [crawl],
  );

  if (!crawl) {
    return (
      <section className="card-surface p-5">
        <h2 className="flex items-center gap-2 font-semibold text-lg tracking-tight">
          <Clock3 className="h-4 w-4 text-zinc-400" /> Crawl hours
        </h2>
        <p className="mt-2 text-sm text-zinc-500">
          No upcoming crawls with venue slots yet — bars appear as soon as venues get agreed hours
          or slot times.
        </p>
      </section>
    );
  }

  const x = (min: number) => (min - crawl.axisStartMin) * PX_PER_MIN;

  return (
    <section className="card-surface overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <h2 className="flex items-center gap-2 font-semibold text-lg tracking-tight">
          <Clock3 className="h-4 w-4 text-zinc-400" /> Crawl hours
        </h2>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="rounded-md border border-zinc-200 p-1 disabled:opacity-40 dark:border-zinc-700"
            aria-label="Previous crawl"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <select
            value={crawl.eventId}
            onChange={(e) => {
              const i = crawls.findIndex((c) => c.eventId === e.target.value);
              if (i >= 0) setIndex(i);
            }}
            className="max-w-[340px] rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {crawls.map((c) => (
              <option key={c.eventId} value={c.eventId}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(crawls.length - 1, i + 1))}
            disabled={index >= crawls.length - 1}
            className="rounded-md border border-zinc-200 p-1 disabled:opacity-40 dark:border-zinc-700"
            aria-label="Next crawl"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex">
        {/* Sticky venue-name rail */}
        <div className="w-44 shrink-0 border-zinc-200/60 border-r dark:border-zinc-800/40">
          <div className="h-7 border-zinc-200/60 border-b dark:border-zinc-800/40" />
          {crawl.bars.map((b) => (
            <div
              key={b.venueEventId}
              style={{ height: ROW_H }}
              className="flex items-center gap-1.5 truncate px-3 text-xs"
              title={b.venueName}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${ROLE_BAR[b.role]?.split(" ")[0] ?? "bg-zinc-400"}`}
              />
              <span className="truncate">{b.venueName}</span>
            </div>
          ))}
        </div>

        {/* Scrollable timeline */}
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ width, minWidth: "100%" }} className="relative">
            {/* Hour ticks */}
            <div className="relative h-7 border-zinc-200/60 border-b dark:border-zinc-800/40">
              {crawl.hourTicks.map((t) => (
                <span
                  key={t.min}
                  style={{ left: x(t.min) }}
                  className="absolute top-1.5 -translate-x-1/2 font-mono text-[9px] text-zinc-400 uppercase"
                >
                  {t.label}
                </span>
              ))}
            </div>

            {/* Grid lines + coverage gaps spanning all rows */}
            <div
              className="absolute inset-x-0 bottom-0"
              style={{ top: 28, height: crawl.bars.length * ROW_H }}
            >
              {crawl.hourTicks.map((t) => (
                <span
                  key={t.min}
                  style={{ left: x(t.min) }}
                  className="absolute inset-y-0 w-px bg-zinc-200/50 dark:bg-zinc-800/50"
                />
              ))}
              {crawl.gaps.map((g) => (
                <span
                  key={`${g.startMin}-${g.endMin}`}
                  style={{ left: x(g.startMin), width: (g.endMin - g.startMin) * PX_PER_MIN }}
                  title="No confirmed venue covers this stretch"
                  className="absolute inset-y-0 bg-rose-500/10 ring-1 ring-rose-400/30 ring-inset"
                />
              ))}
            </div>

            {/* Bars */}
            {crawl.bars.map((b) => (
              <div key={b.venueEventId} style={{ height: ROW_H }} className="relative">
                <Link
                  href={`/events/${crawl.eventId}`}
                  onMouseEnter={() => setHovered(b)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    left: x(b.startMin),
                    width: Math.max(18, (b.endMin - b.startMin) * PX_PER_MIN),
                  }}
                  className={`absolute top-1.5 bottom-1.5 flex items-center truncate rounded-md px-2 font-mono text-[10px] text-white ring-1 transition-transform hover:scale-y-110 ${
                    ROLE_BAR[b.role] ?? "bg-zinc-500/70 ring-zinc-600/50"
                  } ${b.status !== "confirmed" ? "opacity-50 [background-image:repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,.35)_4px,rgba(255,255,255,.35)_6px)]" : ""}`}
                >
                  {b.startLabel}–{b.endLabel}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-zinc-200/60 border-t px-5 py-2.5 dark:border-zinc-800/40">
        {hovered ? (
          <p className="font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
            {hovered.venueName} · {ROLE_LABEL[hovered.role] ?? hovered.role} · {hovered.startLabel}–
            {hovered.endLabel} · {hovered.status}
            {hovered.source === "agreed_text" ? " · parsed from agreed hours" : ""} — click to open
            the crawl
          </p>
        ) : (
          <p className="font-mono text-[10px] text-zinc-400">
            solid = confirmed · hatched = pending · red span = no confirmed coverage
          </p>
        )}
        {crawl.unscheduled.length > 0 && (
          <p className="ml-auto text-[11px] text-amber-700 dark:text-amber-300">
            No times yet:{" "}
            {crawl.unscheduled
              .map((u) => `${u.venueName} (${ROLE_LABEL[u.role] ?? u.role})`)
              .join(", ")}
          </p>
        )}
      </footer>
    </section>
  );
}
