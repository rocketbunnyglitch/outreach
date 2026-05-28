import "server-only";

/**
 * Support hours — scheduling aid for the live-crawl support team.
 *
 * Operator session-12 P3: "running-crawl hours bucketed per timezone;
 * total Eastern + total PHT for scheduling."
 *
 * Crawls run at a wall-clock time in their OWN city's timezone, but the
 * people who monitor live crawls sit in two support hubs:
 *   - Eastern (America/New_York) — JC, Yesu
 *   - PHT     (Asia/Manila)      — Bryle, Gela
 *
 * For scheduling we want to know, per support timezone, WHEN each crawl
 * runs in that zone's local clock and HOW MANY hours of coverage it
 * needs — so we can see nightly load and avoid gaps. A crawl's duration
 * is the same number of hours in every zone; what shifts is the local
 * window (a Sat 10pm–2am crawl in LA is 1am–5am Eastern, 1pm–5pm next
 * day in Manila).
 */

import { events, campaigns, cities, cityCampaigns } from "@/db/schema";
import { db } from "@/lib/db";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";

/** The two support hubs we bucket coverage into. */
export const SUPPORT_ZONES = [
  { key: "eastern", label: "Eastern", timeZone: "America/New_York" },
  { key: "pht", label: "PHT", timeZone: "Asia/Manila" },
] as const;

export type SupportZoneKey = (typeof SUPPORT_ZONES)[number]["key"];

/** Live state of a crawl relative to "now". */
export type SupportCrawlStatus = "missing" | "starting_soon" | "scheduled" | "active" | "completed";

export interface SupportCrawlRow {
  eventId: string;
  /** Composed display name e.g. "Austin Fri Crawl 1". */
  crawlLabel: string;
  cityName: string;
  cityTimezone: string;
  campaignName: string;
  /** ISO date (event_date). */
  eventDate: string;
  /** Crawl duration in hours (end - start). 0 when times are unset. */
  durationHours: number;
  /** Absolute ms timestamps when both times are set, else null. */
  startsAtMs: number | null;
  endsAtMs: number | null;
  /** Per support zone: local start/end clock + the local calendar day.
   *  Includes the city's own zone under key "city". */
  zones: Record<
    SupportZoneKey | "city",
    { localStart: string; localEnd: string; localDay: string } | null
  >;
  /** True when starts_at/ends_at aren't both set (can't bucket precisely). */
  timesMissing: boolean;
  /** Live status against "now". */
  status: SupportCrawlStatus;
}

export interface SupportZoneTotal {
  key: SupportZoneKey;
  label: string;
  timeZone: string;
  /** Sum of crawl coverage hours attributed to this zone. */
  totalHours: number;
  /** Per local-day breakdown (YYYY-MM-DD → hours) in this zone. */
  byDay: Array<{ day: string; hours: number }>;
  /** Earliest crawl start in this zone's local clock (e.g. "4:00 PM"). */
  coverageSpanStart: string | null;
  /** Latest crawl end in this zone's local clock. */
  coverageSpanEnd: string | null;
  /** First and last crawl wall times within this zone for the eyebrow row. */
  firstCrawlAt: string | null;
  lastCrawlAt: string | null;
}

/** Peak overlap window = when the most crawls were concurrently active. */
export interface SupportPeakOverlap {
  /** Local clock in Eastern. */
  localStartEastern: string;
  localEndEastern: string;
  /** Number of crawls active during the entire window. */
  concurrentCrawls: number;
}

export interface SupportNextCrawl {
  eventId: string;
  crawlLabel: string;
  cityName: string;
  startsAtMs: number;
  /** Eastern local time the crawl starts. */
  localStartEastern: string;
  /** Calendar day in Eastern. */
  startsLocalDay: string;
  /** Milliseconds until start. */
  msUntilStart: number;
}

export interface SupportHoursData {
  rows: SupportCrawlRow[];
  totals: SupportZoneTotal[];
  /** Count of crawls we couldn't bucket because times are unset. */
  missingCount: number;
  /** Live status rollup across all rows. */
  liveCounts: {
    active: number;
    startingSoon: number;
    missing: number;
    completed: number;
    scheduled: number;
  };
  /** Window where the most crawls overlap (null if no crawls with times). */
  peakOverlap: SupportPeakOverlap | null;
  /** Next crawl after "now" (null if none upcoming). */
  nextCrawl: SupportNextCrawl | null;
  /** Total elapsed hours covered by at least one crawl (union of windows). */
  globalWindowHours: number;
  /** The "now" used for status calculations — surfaced for UI consistency. */
  computedAtMs: number;
}

function fmtLocal(timeZone: string, at: Date): { time: string; day: string } {
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }); // en-CA → YYYY-MM-DD
  return { time: timeFmt.format(at), day: dayFmt.format(at) };
}

/**
 * Build support-hours data for upcoming crawls. Defaults to crawls from
 * `from` (inclusive) forward, optionally scoped to a campaign.
 */
export async function loadSupportHours(opts?: {
  campaignId?: string | null;
  from?: Date;
}): Promise<SupportHoursData> {
  const from = opts?.from ?? new Date();
  // event_date is a DATE; compare on date string so "today" is included
  // regardless of the current time.
  const fromDate = from.toISOString().slice(0, 10);

  const rows = await db
    .select({
      eventId: events.id,
      eventDate: events.eventDate,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      cityName: cities.name,
      cityTimezone: cities.timezone,
      cityCampaignId: events.cityCampaignId,
      dayPart: events.dayPart,
      crawlNumber: events.crawlNumber,
    })
    .from(events)
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .where(
      and(
        gte(events.eventDate, fromDate),
        isNull(events.archivedAt),
        opts?.campaignId ? eq(cityCampaigns.campaignId, opts.campaignId) : undefined,
      ),
    )
    .orderBy(events.eventDate);

  // Resolve campaign names in one extra pass (kept simple; small N).
  const campaignNameByCc = await resolveCampaignNames(rows.map((r) => r.cityCampaignId));

  const computedAtMs = (opts?.from ?? new Date()).getTime();
  const SOON_WINDOW_MS = 2 * 60 * 60 * 1000; // "starting soon" = <=2h to start

  const out: SupportCrawlRow[] = [];
  // Absolute-time windows of every crawl with both times set; the total
  // coverage is the UNION of these (overlaps counted once), not the sum of
  // each crawl's duration.
  const intervals: Array<[number, number]> = [];
  let missingCount = 0;
  const liveCounts = { active: 0, startingSoon: 0, missing: 0, completed: 0, scheduled: 0 };
  let nextStartCandidate: {
    eventId: string;
    crawlLabel: string;
    cityName: string;
    startsAtMs: number;
  } | null = null;

  // Per-zone min start and max end (in ms) for the coverage-span eyebrow.
  const zoneSpan: Record<SupportZoneKey, { minStart: number; maxEnd: number } | null> = {
    eastern: null,
    pht: null,
  };

  for (const r of rows) {
    const timesMissing = !r.startsAt || !r.endsAt;
    let durationHours = 0;
    let startsAtMs: number | null = null;
    let endsAtMs: number | null = null;
    const zones: SupportCrawlRow["zones"] = { eastern: null, pht: null, city: null };
    let status: SupportCrawlStatus = "missing";

    const crawlLabel = buildCrawlLabel({
      cityName: r.cityName,
      dayPart: r.dayPart,
      crawlNumber: r.crawlNumber,
      eventDate: String(r.eventDate),
    });

    if (!timesMissing && r.startsAt && r.endsAt) {
      const start = r.startsAt instanceof Date ? r.startsAt : new Date(r.startsAt);
      const end = r.endsAt instanceof Date ? r.endsAt : new Date(r.endsAt);
      startsAtMs = start.getTime();
      endsAtMs = end.getTime();
      durationHours = Math.max(0, (endsAtMs - startsAtMs) / 3_600_000);
      if (endsAtMs > startsAtMs) intervals.push([startsAtMs, endsAtMs]);

      for (const z of SUPPORT_ZONES) {
        const s = fmtLocal(z.timeZone, start);
        const e = fmtLocal(z.timeZone, end);
        zones[z.key] = { localStart: s.time, localEnd: e.time, localDay: s.day };
        // Track per-zone span min/max.
        const cur = zoneSpan[z.key];
        if (!cur) {
          zoneSpan[z.key] = { minStart: startsAtMs, maxEnd: endsAtMs };
        } else {
          cur.minStart = Math.min(cur.minStart, startsAtMs);
          cur.maxEnd = Math.max(cur.maxEnd, endsAtMs);
        }
      }
      // City's own zone (uses cities.timezone).
      const cs = fmtLocal(r.cityTimezone, start);
      const ce = fmtLocal(r.cityTimezone, end);
      zones.city = { localStart: cs.time, localEnd: ce.time, localDay: cs.day };

      // Compute status against "now".
      if (computedAtMs < startsAtMs) {
        status = startsAtMs - computedAtMs <= SOON_WINDOW_MS ? "starting_soon" : "scheduled";
      } else if (computedAtMs <= endsAtMs) {
        status = "active";
      } else {
        status = "completed";
      }
      // Tally + next-crawl candidate.
      if (status === "active") liveCounts.active += 1;
      else if (status === "starting_soon") liveCounts.startingSoon += 1;
      else if (status === "completed") liveCounts.completed += 1;
      else liveCounts.scheduled += 1;

      if (startsAtMs > computedAtMs) {
        if (!nextStartCandidate || startsAtMs < nextStartCandidate.startsAtMs) {
          nextStartCandidate = {
            eventId: r.eventId,
            crawlLabel,
            cityName: r.cityName,
            startsAtMs,
          };
        }
      }
    } else {
      missingCount += 1;
      status = "missing";
      liveCounts.missing += 1;
    }

    out.push({
      eventId: r.eventId,
      crawlLabel,
      cityName: r.cityName,
      cityTimezone: r.cityTimezone,
      campaignName: campaignNameByCc.get(r.cityCampaignId) ?? "—",
      eventDate: String(r.eventDate),
      durationHours,
      startsAtMs,
      endsAtMs,
      zones,
      timesMissing,
      status,
    });
  }

  // Total coverage hours = union of all crawl windows. Two crawls running at
  // the same time need ONE support shift, not two — so e.g. a Sat 4pm-Sun 8am
  // span is 16h total regardless of how many crawls fall inside it. The hours
  // are the same in both zones (elapsed time is zone-invariant); only the
  // per-local-day split differs.
  const merged = mergeIntervals(intervals);
  const unionHours = merged.reduce((sum, [s, e]) => sum + (e - s) / 3_600_000, 0);

  const totals: SupportZoneTotal[] = SUPPORT_ZONES.map((z) => {
    const byDayMap = new Map<string, number>();
    for (const [s, e] of merged) {
      // Attribute each merged window to its local START day in this zone.
      const day = fmtLocal(z.timeZone, new Date(s)).day;
      byDayMap.set(day, (byDayMap.get(day) ?? 0) + (e - s) / 3_600_000);
    }
    const span = zoneSpan[z.key];
    return {
      key: z.key,
      label: z.label,
      timeZone: z.timeZone,
      totalHours: Math.round(unionHours * 10) / 10,
      byDay: Array.from(byDayMap.entries())
        .map(([day, hours]) => ({ day, hours: Math.round(hours * 10) / 10 }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      coverageSpanStart: span ? fmtLocal(z.timeZone, new Date(span.minStart)).time : null,
      coverageSpanEnd: span ? fmtLocal(z.timeZone, new Date(span.maxEnd)).time : null,
      firstCrawlAt: span ? fmtLocal(z.timeZone, new Date(span.minStart)).time : null,
      lastCrawlAt: span ? fmtLocal(z.timeZone, new Date(span.maxEnd)).time : null,
    };
  });

  // Peak overlap: sweep over interval endpoints, find the maximum concurrent
  // overlap and report its window in Eastern local clock.
  const peakOverlap = computePeakOverlap(intervals);

  // Next crawl payload.
  let nextCrawl: SupportNextCrawl | null = null;
  if (nextStartCandidate) {
    const fmt = fmtLocal("America/New_York", new Date(nextStartCandidate.startsAtMs));
    nextCrawl = {
      eventId: nextStartCandidate.eventId,
      crawlLabel: nextStartCandidate.crawlLabel,
      cityName: nextStartCandidate.cityName,
      startsAtMs: nextStartCandidate.startsAtMs,
      localStartEastern: fmt.time,
      startsLocalDay: fmt.day,
      msUntilStart: nextStartCandidate.startsAtMs - computedAtMs,
    };
  }

  return {
    rows: out,
    totals,
    missingCount,
    liveCounts,
    peakOverlap,
    nextCrawl,
    globalWindowHours: Math.round(unionHours * 10) / 10,
    computedAtMs,
  };
}

/** Compose a crawl's display label. Falls back to date when day/slot missing. */
function buildCrawlLabel(opts: {
  cityName: string;
  dayPart: string | null;
  crawlNumber: number | null;
  eventDate: string;
}): string {
  const day = opts.dayPart
    ? opts.dayPart.charAt(0).toUpperCase() + opts.dayPart.slice(1, 3).toLowerCase()
    : null;
  const slot = opts.crawlNumber ? `Crawl ${opts.crawlNumber}` : null;
  if (day && slot) return `${opts.cityName} ${day} ${slot}`;
  if (slot) return `${opts.cityName} ${slot}`;
  return `${opts.cityName} ${opts.eventDate}`;
}

/** Sweep-line peak overlap. Returns the longest contiguous window where the
 *  maximum concurrent crawls were running. Window expressed in Eastern. */
function computePeakOverlap(intervals: Array<[number, number]>): SupportPeakOverlap | null {
  if (intervals.length === 0) return null;
  type Pt = { t: number; d: 1 | -1 };
  const pts: Pt[] = [];
  for (const [s, e] of intervals) {
    pts.push({ t: s, d: 1 });
    pts.push({ t: e, d: -1 });
  }
  // Process starts before ends at the same t so 4pm start + 4pm end counts overlap.
  pts.sort((a, b) => a.t - b.t || b.d - a.d);
  let cur = 0;
  let peak = 0;
  let peakStart: number | null = null;
  let peakEnd: number | null = null;
  let runStart: number | null = null;
  for (const p of pts) {
    cur += p.d;
    if (cur > peak) {
      peak = cur;
      runStart = p.t;
      peakStart = p.t;
      peakEnd = p.t;
    } else if (cur === peak && runStart !== null) {
      peakEnd = p.t;
    } else if (cur < peak) {
      // Run ended; commit current window.
      if (runStart !== null && peakStart === runStart) peakEnd = p.t;
      runStart = null;
    }
  }
  if (peak === 0 || peakStart === null || peakEnd === null) return null;
  return {
    localStartEastern: fmtLocal("America/New_York", new Date(peakStart)).time,
    localEndEastern: fmtLocal("America/New_York", new Date(peakEnd)).time,
    concurrentCrawls: peak,
  };
}

/** Merge overlapping/adjacent [start,end] ms intervals into disjoint windows. */
function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const cur of sorted) {
    const last = merged[merged.length - 1];
    if (last && cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      merged.push([cur[0], cur[1]]);
    }
  }
  return merged;
}

/**
 * city_campaign_id → campaign name. Separate tiny query to avoid a
 * second join in the main select; N is small (upcoming crawls only).
 */
async function resolveCampaignNames(ccIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(ccIds));
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      ccId: cityCampaigns.id,
      campaignName: campaigns.name,
    })
    .from(cityCampaigns)
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .where(inArray(cityCampaigns.id, ids));
  return new Map(rows.map((r) => [r.ccId, r.campaignName]));
}
