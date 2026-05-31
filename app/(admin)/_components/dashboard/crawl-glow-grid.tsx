"use client";

/**
 * CrawlGlowGrid — compact per-crawl status visualization for the
 * dashboard tracker.
 *
 * Renders one row per day (Thu/Fri/Sat/...), each row containing
 * one glow pill per crawl on that day, ordered by crawl number.
 * The color of each pill encodes the crawl's booking progress:
 *
 *   grey   = no outreach started yet (0 venues, no cold sends)
 *   red    = outreach started but 0 of 4 venues confirmed
 *   orange = 1 of 4 venues confirmed (3 still pending)
 *   yellow = 2 of 4 venues confirmed (2 still pending)
 *   blue   = 3 of 4 venues confirmed (1 still pending)
 *   green  = all 4 venues confirmed (complete)
 *   slate  = crawl cancelled (separate from grey "not started")
 *
 * Stacked tight to minimize vertical real estate — operators scan
 * many cities at once on the tracker, so the grid needs to be
 * dense enough to live inside a normal row.
 */

import { cn } from "@/lib/cn";
import type { CrawlNeed } from "@/lib/tracker-status-types";

type GlowTone = "grey" | "red" | "orange" | "yellow" | "blue" | "green" | "slate";

/** Pick the tone for a crawl based on its confirmed-venue count +
 *  outreach-started signal. The mapping is the operator-supplied
 *  spec — don't change without checking with the team. */
function toneForCrawl(c: CrawlNeed): GlowTone {
  if (c.status === "cancelled") return "slate";
  if (c.confirmedVenueCount >= 4) return "green";
  if (c.confirmedVenueCount === 3) return "blue";
  if (c.confirmedVenueCount === 2) return "yellow";
  if (c.confirmedVenueCount === 1) return "orange";
  // 0 confirmed
  return c.outreachStarted ? "red" : "grey";
}

/** Tailwind classes per tone. The "glow" effect is just a colored
 *  shadow at low blur — the rounded pill itself stays a solid
 *  color so it reads even in light mode. */
const GLOW_CLASS: Record<GlowTone, string> = {
  grey: "bg-zinc-400/60 shadow-[0_0_4px_rgba(161,161,170,0.4)] dark:bg-zinc-500/70 dark:shadow-[0_0_5px_rgba(113,113,122,0.5)]",
  red: "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.65)] dark:bg-rose-500 dark:shadow-[0_0_8px_rgba(244,63,94,0.75)]",
  orange:
    "bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.65)] dark:bg-orange-500 dark:shadow-[0_0_8px_rgba(249,115,22,0.75)]",
  yellow:
    "bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.65)] dark:bg-yellow-400 dark:shadow-[0_0_8px_rgba(250,204,21,0.75)]",
  blue: "bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.65)] dark:bg-blue-500 dark:shadow-[0_0_8px_rgba(59,130,246,0.75)]",
  green:
    "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)] dark:bg-emerald-500 dark:shadow-[0_0_8px_rgba(16,185,129,0.8)]",
  slate: "bg-zinc-700/30 dark:bg-zinc-700/50",
};

/** Three-letter labels per dayPart. Short enough to live in the
 *  left margin of each row without forcing the pills to shrink. */
const DAY_LABEL: Record<string, string> = {
  thursday_night: "Thu",
  friday_night: "Fri",
  saturday_day: "Sat",
  saturday_night: "Sat",
  sunday_day: "Sun",
  sunday_night: "Sun",
  other: "Oth",
};

/** Display order for dayPart rows — keeps the grid laid out
 *  chronologically regardless of the order crawls came back in. */
const DAY_ORDER: string[] = [
  "thursday_night",
  "friday_night",
  "saturday_day",
  "saturday_night",
  "sunday_day",
  "sunday_night",
  "other",
];

/** Word-form labels for tooltip readability. */
const DAY_LABEL_LONG: Record<string, string> = {
  thursday_night: "Thursday night",
  friday_night: "Friday night",
  saturday_day: "Saturday day",
  saturday_night: "Saturday night",
  sunday_day: "Sunday day",
  sunday_night: "Sunday night",
  other: "Other",
};

const TONE_LABEL: Record<GlowTone, string> = {
  grey: "Not started",
  red: "Outreach started · 0 of 4 booked",
  orange: "1 of 4 booked",
  yellow: "2 of 4 booked",
  blue: "3 of 4 booked",
  green: "Complete · 4 of 4 booked",
  slate: "Cancelled",
};

export function CrawlGlowGrid({
  crawls,
  onClick,
  status,
}: {
  crawls: CrawlNeed[];
  /** When provided, the grid renders as a button — clicking
   *  anywhere on it fires this callback. Used to open the
   *  active/cancelled picker for the parent city. */
  onClick?: () => void;
  /** Current city status. When 'cancelled', the entire grid is
   *  dimmed + strikethrough-style so the operator can see at a
   *  glance that the row is dead without expanding it. */
  status?: "planning" | "active" | "confirmed" | "cancelled";
}) {
  // Group crawls by dayPart, sort within each by crawlNumber so the
  // pill row reads as "crawl 1 ... crawl N" left-to-right exactly
  // like the operator expects.
  const byDay = new Map<string, CrawlNeed[]>();
  for (const c of crawls) {
    const list = byDay.get(c.dayPart) ?? [];
    list.push(c);
    byDay.set(c.dayPart, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.crawlNumber - b.crawlNumber);
  }

  // Visible days in canonical order, skipping empty ones.
  const days = DAY_ORDER.filter((d) => byDay.has(d));

  if (days.length === 0) return null;

  const cancelled = status === "cancelled";
  const inner = (
    <div className={cn("flex flex-col gap-0.5", cancelled && "opacity-40")}>
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        return (
          <div key={d} className="flex items-center gap-1.5" title={DAY_LABEL_LONG[d] ?? d}>
            <span className="w-7 shrink-0 font-mono text-[8.5px] text-zinc-500 uppercase tracking-widest">
              {DAY_LABEL[d] ?? d.slice(0, 3)}
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {list.map((c) => {
                const tone = cancelled ? "slate" : toneForCrawl(c);
                return (
                  <span
                    key={`${c.dayPart}-${c.crawlNumber}`}
                    aria-label={`Crawl ${c.crawlNumber}: ${TONE_LABEL[tone]}`}
                    title={`Crawl ${c.crawlNumber} · ${TONE_LABEL[tone]}`}
                    className={cn(
                      // Pill: 16px wide × 4px tall, rounded full. Tight
                      // so a city with 4 crawls × 3 days still fits in
                      // a normal row without pushing the row height.
                      "inline-block h-1 w-4 rounded-full",
                      GLOW_CLASS[tone],
                    )}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Click to set city status"
        className="rounded-md p-0.5 text-left transition-colors hover:bg-zinc-200/40 focus:outline-none focus:ring-1 focus:ring-zinc-400/40 dark:hover:bg-zinc-800/40"
      >
        {inner}
      </button>
    );
  }
  return inner;
}
