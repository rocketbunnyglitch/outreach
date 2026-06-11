import "server-only";

/**
 * Data for the /crawl-support crawl-night grid (v2, 2026-06-11).
 *
 * v1 plotted crawls on a 0-100% time axis; with every crawl clustered on
 * 2-3 Halloween nights the dots stacked into an unreadable smear, so the
 * operator "didn't see" the chart. v2 is a date grid instead: one COLUMN
 * per distinct crawl night, one ROW per city, a clickable chip per crawl.
 * Stretches with no crawls collapse into a single narrow "dark nights"
 * column and are summarized in `gapSummary` so the operator knows which
 * nights need NO support coverage.
 *
 * All date math + labels are precomputed here (UTC-pinned, date-only
 * values) so the client component is hydration-safe.
 */

import type { GanttColumn, GanttRow } from "@/app/(admin)/crawl-support/_components/crawl-gantt";
import { events, cities, cityCampaigns } from "@/db/schema";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;
const NIGHT_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const SHORT_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** Distinguishes day vs night crawls inside a single date column. */
const DAY_PART_SHORT: Record<string, string> = {
  thursday_night: "Thu",
  friday_night: "Fri",
  saturday_day: "Sat·D",
  saturday_night: "Sat",
  sunday_day: "Sun·D",
  sunday_night: "Sun",
  other: "",
};

export interface CrawlGanttData {
  columns: GanttColumn[];
  rows: GanttRow[];
  rangeLabel: string;
  /** Human summary of the dark stretches inside the range, e.g.
   *  "Nov 1 · Nov 3–6". Empty string when every night has a crawl. */
  gapSummary: string;
  crawlNights: number;
  gapNights: number;
}

const EMPTY: CrawlGanttData = {
  columns: [],
  rows: [],
  rangeLabel: "",
  gapSummary: "",
  crawlNights: 0,
  gapNights: 0,
};

export async function loadCrawlGantt(): Promise<CrawlGanttData> {
  try {
    const current = await getCurrentCampaign();
    if (!current) return EMPTY;

    const raw = await db
      .select({
        eventId: events.id,
        eventDate: events.eventDate,
        dayPart: events.dayPart,
        crawlNumber: events.crawlNumber,
        crawlName: events.crawlName,
        cityName: cities.name,
      })
      .from(events)
      .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
      .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
      .where(
        and(
          eq(cityCampaigns.campaignId, current.campaign.id),
          isNull(events.archivedAt),
          sql`${events.eventDate} >= (now() at time zone 'America/Toronto')::date`,
        ),
      )
      .orderBy(asc(cities.name), asc(events.eventDate));
    if (raw.length === 0) return EMPTY;

    const toMs = (d: unknown) => new Date(`${String(d)}T00:00:00Z`).getTime();
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

    // Distinct crawl nights, sorted ascending.
    const nightSet = new Set<number>();
    for (const r of raw) {
      const ms = toMs(r.eventDate);
      if (Number.isFinite(ms)) nightSet.add(ms);
    }
    const nightList = [...nightSet].sort((a, b) => a - b);
    const min = nightList[0];
    const max = nightList[nightList.length - 1];
    if (min === undefined || max === undefined) return EMPTY;

    // Walk min..max one calendar night at a time. Crawl nights become
    // real columns; consecutive dark nights collapse into ONE narrow
    // gap column so a quiet week doesn't eat the whole grid.
    const columns: GanttColumn[] = [];
    const gapParts: string[] = [];
    let gapNights = 0;
    let t = min;
    while (t <= max) {
      if (nightSet.has(t)) {
        columns.push({
          key: iso(t),
          dateIso: iso(t),
          label: NIGHT_FMT.format(new Date(t)),
          isGap: false,
          totalCrawls: 0,
        });
        t += DAY_MS;
      } else {
        const from = t;
        while (t <= max && !nightSet.has(t)) t += DAY_MS;
        const to = t - DAY_MS;
        const n = (to - from) / DAY_MS + 1;
        gapNights += n;
        gapParts.push(
          n === 1
            ? SHORT_FMT.format(new Date(from))
            : `${SHORT_FMT.format(new Date(from))}–${SHORT_FMT.format(new Date(to))}`,
        );
        columns.push({
          key: `gap-${iso(from)}`,
          dateIso: null,
          label: n === 1 ? "1 dark night" : `${n} dark nights`,
          isGap: true,
          totalCrawls: 0,
        });
      }
    }

    const colIndexByIso = new Map<string, number>();
    columns.forEach((c, i) => {
      if (c.dateIso) colIndexByIso.set(c.dateIso, i);
    });

    const byCity = new Map<string, GanttRow>();
    for (const r of raw) {
      const ms = toMs(r.eventDate);
      if (!Number.isFinite(ms)) continue;
      const idx = colIndexByIso.get(iso(ms));
      if (idx === undefined) continue;
      const col = columns[idx];
      if (!col) continue;
      let row = byCity.get(r.cityName);
      if (!row) {
        row = { cityName: r.cityName, cells: columns.map(() => []) };
        byCity.set(r.cityName, row);
      }
      const dayPartShort = DAY_PART_SHORT[String(r.dayPart ?? "")] ?? "";
      const chip =
        [dayPartShort || null, r.crawlNumber != null ? `#${r.crawlNumber}` : null]
          .filter(Boolean)
          .join(" ") || "crawl";
      const longName =
        r.crawlName?.trim() ||
        `${String(r.dayPart ?? "crawl").replace(/_/g, " ")} ${r.crawlNumber ?? ""}`.trim();
      row.cells[idx]?.push({
        eventId: r.eventId,
        chip,
        title: `${longName} · ${r.cityName} · ${NIGHT_FMT.format(new Date(ms))}`,
      });
      col.totalCrawls += 1;
    }

    return {
      columns,
      rows: [...byCity.values()],
      rangeLabel: `${SHORT_FMT.format(new Date(min))} – ${SHORT_FMT.format(new Date(max))}`,
      gapSummary: gapParts.join(" · "),
      crawlNights: nightList.length,
      gapNights,
    };
  } catch (err) {
    logger.error({ err }, "loadCrawlGantt failed");
    return EMPTY;
  }
}
