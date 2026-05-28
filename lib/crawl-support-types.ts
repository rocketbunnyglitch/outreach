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
  /** Confirmed venue per role (null when none confirmed yet). */
  wristbandVenue: string | null;
  middleVenues: string[];
  finalVenue: string | null;
  /** Shipping status of the wristband-role venue's wristbands row. */
  wristbandStatus: "pending" | "ready_to_ship" | "shipped" | "delivered" | "issue" | null;
  /** Assigned hosts (internal = 1 expected; external = 2 expected). */
  hosts: Array<{ type: "internal" | "external"; name: string; slot: number }>;
  /** Derived event-night readiness risk. */
  supportRisk: SupportRisk;
}

export type SupportRisk = "low" | "medium" | "high";

export const RISK_LABEL: Record<SupportRisk, string> = {
  low: "Low risk",
  medium: "At risk",
  high: "High risk",
};

export const RISK_TONE: Record<SupportRisk, string> = {
  low: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400",
  medium: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300",
  high: "bg-red-500/15 text-red-700 ring-red-500/30 dark:text-red-300",
};

/**
 * Derive event-night readiness risk from the gaps that actually bite during
 * live support: no confirmed wristband/final venue, no host assigned,
 * wristbands not yet shipped, or missing times. Heuristic + tunable.
 */
export function computeSupportRisk(c: {
  status: CrawlSupportStatus;
  timesMissing: boolean;
  wristbandVenue: string | null;
  finalVenue: string | null;
  hosts: Array<{ type: "internal" | "external"; name: string; slot: number }>;
  wristbandStatus: SupportCrawl["wristbandStatus"];
}): SupportRisk {
  let factors = 0;
  if (!c.wristbandVenue) factors++;
  if (!c.finalVenue) factors++;
  if (c.hosts.length === 0) factors++;
  if (c.wristbandStatus !== "shipped" && c.wristbandStatus !== "delivered") factors++;
  if (c.timesMissing) factors++;
  // Past/far-future crawls de-emphasised — gaps matter less once it's over or
  // still days out.
  if (c.status === "completed" || c.status === "scheduled") {
    return factors >= 3 ? "medium" : "low";
  }
  if (factors >= 2) return "high";
  if (factors === 1) return "medium";
  return "low";
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

// =========================================================================
// Crawl issues (live-support issue logging) — client-safe types + labels
// =========================================================================

export type CrawlIssueType =
  | "venue_not_expecting"
  | "capacity"
  | "door_line"
  | "wristband_checkin"
  | "final_venue"
  | "wrong_address"
  | "manager_unavailable"
  | "schedule_confusion"
  | "attendee_complaint"
  | "staff_no_show"
  | "other";

export type CrawlIssueSeverity = "low" | "medium" | "high" | "critical";
export type CrawlIssueStatus = "open" | "in_progress" | "resolved";

export interface SupportIssue {
  id: string;
  issueType: CrawlIssueType;
  severity: CrawlIssueSeverity;
  status: CrawlIssueStatus;
  cityName: string | null;
  campaignName: string | null;
  crawlLabel: string | null;
  venueName: string | null;
  callerContact: string | null;
  assignedStaffName: string | null;
  notes: string | null;
  createdAtIso: string;
  resolvedAtIso: string | null;
}

export const ISSUE_TYPE_LABEL: Record<CrawlIssueType, string> = {
  venue_not_expecting: "Venue not expecting us",
  capacity: "Capacity issue",
  door_line: "Door / line issue",
  wristband_checkin: "Wristband / check-in",
  final_venue: "Final venue issue",
  wrong_address: "Wrong address",
  manager_unavailable: "Manager unavailable",
  schedule_confusion: "Schedule confusion",
  attendee_complaint: "Attendee complaint",
  staff_no_show: "Staff / no-show",
  other: "Other",
};

export const ISSUE_TYPE_ORDER: CrawlIssueType[] = [
  "venue_not_expecting",
  "capacity",
  "door_line",
  "wristband_checkin",
  "final_venue",
  "wrong_address",
  "manager_unavailable",
  "schedule_confusion",
  "attendee_complaint",
  "staff_no_show",
  "other",
];

export const SEVERITY_LABEL: Record<CrawlIssueSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const SEVERITY_TONE: Record<CrawlIssueSeverity, string> = {
  low: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-400",
  medium: "bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300",
  high: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300",
  critical: "bg-red-500/15 text-red-700 ring-red-500/30 dark:text-red-300",
};

// =========================================================================
// Call logs (live-support telephony) — client-safe types
// =========================================================================

export type CallMatchType = "venue" | "staff" | "prior" | "area_code" | "none";
export type CallDirection = "incoming" | "outgoing";

export interface SupportCall {
  id: string;
  direction: CallDirection;
  fromE164: string | null;
  toE164: string | null;
  callerName: string | null;
  status: string | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  occurredAtIso: string;
  matchType: CallMatchType;
  matchedVenueName: string | null;
  matchedStaffName: string | null;
  areaCode: string | null;
}

/** A call counts as "unmatched" (surface prominently) when it has no exact
 *  attribution — none, or only the weak area-code hint. */
export function isUnmatchedCall(c: { matchType: CallMatchType }): boolean {
  return c.matchType === "none" || c.matchType === "area_code";
}

export const MATCH_LABEL: Record<CallMatchType, string> = {
  venue: "Venue",
  staff: "Staff",
  prior: "Prior caller",
  area_code: "Area-code guess",
  none: "Unmatched",
};

// =========================================================================
// Reverse search (cross-entity lookup) — client-safe types
// =========================================================================

export interface ReverseSearchResults {
  venues: Array<{ id: string; name: string; phoneE164: string | null; email: string | null }>;
  cities: Array<{ id: string; name: string }>;
  calls: Array<{
    id: string;
    fromE164: string | null;
    callerName: string | null;
    matchedVenueName: string | null;
    occurredAtIso: string;
  }>;
}
