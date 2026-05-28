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

export interface SupportCrawlRow {
  eventId: string;
  cityName: string;
  campaignName: string;
  /** ISO date (event_date). */
  eventDate: string;
  /** Crawl duration in hours (end - start). 0 when times are unset. */
  durationHours: number;
  /** Per support zone: local start/end clock + the local calendar day. */
  zones: Record<SupportZoneKey, { localStart: string; localEnd: string; localDay: string } | null>;
  /** True when starts_at/ends_at aren't both set (can't bucket precisely). */
  timesMissing: boolean;
}

export interface SupportZoneTotal {
  key: SupportZoneKey;
  label: string;
  timeZone: string;
  /** Sum of crawl coverage hours attributed to this zone. */
  totalHours: number;
  /** Per local-day breakdown (YYYY-MM-DD → hours) in this zone. */
  byDay: Array<{ day: string; hours: number }>;
}

export interface SupportHoursData {
  rows: SupportCrawlRow[];
  totals: SupportZoneTotal[];
  /** Count of crawls we couldn't bucket because times are unset. */
  missingCount: number;
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
      cityCampaignId: events.cityCampaignId,
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

  const out: SupportCrawlRow[] = [];
  const dayTotals: Record<SupportZoneKey, Map<string, number>> = {
    eastern: new Map(),
    pht: new Map(),
  };
  const zoneTotalHours: Record<SupportZoneKey, number> = { eastern: 0, pht: 0 };
  let missingCount = 0;

  for (const r of rows) {
    const timesMissing = !r.startsAt || !r.endsAt;
    let durationHours = 0;
    const zones: SupportCrawlRow["zones"] = { eastern: null, pht: null };

    if (!timesMissing && r.startsAt && r.endsAt) {
      const start = r.startsAt instanceof Date ? r.startsAt : new Date(r.startsAt);
      const end = r.endsAt instanceof Date ? r.endsAt : new Date(r.endsAt);
      durationHours = Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);

      for (const z of SUPPORT_ZONES) {
        const s = fmtLocal(z.timeZone, start);
        const e = fmtLocal(z.timeZone, end);
        zones[z.key] = { localStart: s.time, localEnd: e.time, localDay: s.day };
        // Attribute the crawl's coverage hours to the local start day in
        // this zone (a crawl is one shift; splitting across midnight adds
        // complexity without scheduling value).
        zoneTotalHours[z.key] += durationHours;
        dayTotals[z.key].set(s.day, (dayTotals[z.key].get(s.day) ?? 0) + durationHours);
      }
    } else {
      missingCount += 1;
    }

    out.push({
      eventId: r.eventId,
      cityName: r.cityName,
      campaignName: campaignNameByCc.get(r.cityCampaignId) ?? "—",
      eventDate: String(r.eventDate),
      durationHours,
      zones,
      timesMissing,
    });
  }

  const totals: SupportZoneTotal[] = SUPPORT_ZONES.map((z) => ({
    key: z.key,
    label: z.label,
    timeZone: z.timeZone,
    totalHours: Math.round(zoneTotalHours[z.key] * 10) / 10,
    byDay: Array.from(dayTotals[z.key].entries())
      .map(([day, hours]) => ({ day, hours: Math.round(hours * 10) / 10 }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  }));

  return { rows: out, totals, missingCount };
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
