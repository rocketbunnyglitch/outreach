/**
 * Client-safe types, labels, and PURE status logic for Crawl Support.
 * No DB / server-only imports here so client components can use it. The
 * server-only loader (lib/crawl-support.ts) imports from this file.
 */

export type CrawlSupportStatus =
  | "starts_soon"
  | "check_in_active"
  | "running_now"
  | "final_venue_upcoming"
  | "ending_soon"
  | "completed"
  | "scheduled";

export type SupportBucket = "active" | "starting_soon" | "completed" | "scheduled";

export interface SupportCrawl {
  eventId: string;
  campaignName: string;
  cityName: string;
  timezone: string;
  dayPart: string | null;
  crawlNumber: number | null;
  eventDate: string;
  status: CrawlSupportStatus;
  bucket: SupportBucket;
  /** ISO instants (UTC) — null when Eventbrite times aren't synced yet. */
  startsAtIso: string | null;
  endsAtIso: string | null;
  /** Wall-clock start/end in the city's own timezone, e.g. "10:00 PM". */
  startLocal: string | null;
  endLocal: string | null;
  ticketSalesCount: number;
  /** True when starts_at/ends_at aren't both set (status falls back). */
  timesMissing: boolean;
}

export interface CrawlSupportData {
  nowIso: string;
  crawls: SupportCrawl[];
  counts: Record<SupportBucket, number>;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

// Phase thresholds (tunable). Check-in covers the first stretch after start;
// the final-venue / ending phases are measured from the end.
export const STARTS_SOON_LEAD = 2 * HOUR;
export const CHECK_IN_WINDOW = 90 * MIN;
export const FINAL_VENUE_REMAINING = 90 * MIN;
export const ENDING_SOON_REMAINING = 30 * MIN;
export const COMPLETED_LOOKBACK = 12 * HOUR;

/** YYYY-MM-DD and hour (0-23) of an instant in a timezone. */
function localDateParts(timeZone: string, at: Date): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hourRaw = get("hour");
  const hour = hourRaw === "24" ? 0 : Number(hourRaw);
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour };
}

function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Is `now` within the support activation window for a crawl on `eventDate`
 * in `timeZone`? Window = 10:00 local on the crawl day → 12:00 local next day.
 */
export function inActivationWindow(now: Date, eventDate: string, timeZone: string): boolean {
  const { day, hour } = localDateParts(timeZone, now);
  if (day === eventDate) return hour >= 10;
  if (day === nextDay(eventDate)) return hour < 12;
  return false;
}

/** Compute the live status of a single crawl. Pure — trivially testable. */
export function computeCrawlStatus(
  now: Date,
  startsAt: Date | null,
  endsAt: Date | null,
): CrawlSupportStatus {
  if (!startsAt || !endsAt) return "scheduled";
  const t = now.getTime();
  const start = startsAt.getTime();
  const end = endsAt.getTime();

  if (t >= end) return "completed";
  if (t < start) {
    return start - t <= STARTS_SOON_LEAD ? "starts_soon" : "scheduled";
  }
  const elapsed = t - start;
  const remaining = end - t;
  if (remaining <= ENDING_SOON_REMAINING) return "ending_soon";
  if (remaining <= FINAL_VENUE_REMAINING) return "final_venue_upcoming";
  if (elapsed <= CHECK_IN_WINDOW) return "check_in_active";
  return "running_now";
}

export function bucketFor(
  status: CrawlSupportStatus,
  now: Date,
  endsAt: Date | null,
): SupportBucket {
  switch (status) {
    case "starts_soon":
      return "starting_soon";
    case "completed":
      return endsAt && now.getTime() - endsAt.getTime() <= COMPLETED_LOOKBACK
        ? "completed"
        : "scheduled";
    case "scheduled":
      return "scheduled";
    default:
      return "active";
  }
}

export const STATUS_LABEL: Record<CrawlSupportStatus, string> = {
  starts_soon: "Starts Soon",
  check_in_active: "Check-In Active",
  running_now: "Running Now",
  final_venue_upcoming: "Final Venue Upcoming",
  ending_soon: "Ending Soon",
  completed: "Completed",
  scheduled: "Scheduled",
};

export const STATUS_TONE: Record<CrawlSupportStatus, string> = {
  starts_soon: "bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300",
  check_in_active: "bg-violet-500/15 text-violet-700 ring-violet-500/30 dark:text-violet-300",
  running_now: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
  final_venue_upcoming: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300",
  ending_soon: "bg-orange-500/15 text-orange-700 ring-orange-500/30 dark:text-orange-300",
  completed: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-400",
  scheduled: "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20 dark:text-zinc-400",
};
