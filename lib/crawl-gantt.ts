import "server-only";

/**
 * Data for the /crawl-support crawl-overlap timeline (scaffold 2026-06-10).
 * Loads every upcoming non-archived crawl of the CURRENT campaign and
 * precomputes axis positions + display labels server-side (UTC-pinned,
 * date-only values) so the client component is hydration-safe.
 */

import type { GanttAxisTick, GanttRow } from "@/app/(admin)/crawl-support/_components/crawl-gantt";
import { events, cities, cityCampaigns } from "@/db/schema";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;
const LABEL_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export interface CrawlGanttData {
  rows: GanttRow[];
  ticks: GanttAxisTick[];
  rangeLabel: string;
}

export async function loadCrawlGantt(): Promise<CrawlGanttData> {
  const empty: CrawlGanttData = { rows: [], ticks: [], rangeLabel: "" };
  try {
    const current = await getCurrentCampaign();
    if (!current) return empty;

    const rows = await db
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
    if (rows.length === 0) return empty;

    const toMs = (d: unknown) => new Date(`${String(d)}T00:00:00Z`).getTime();
    const allMs = rows.map((r) => toMs(r.eventDate)).filter((n) => Number.isFinite(n));
    const min = Math.min(...allMs);
    const max = Math.max(...allMs);
    const span = Math.max(DAY_MS, max - min);
    const pct = (ms: number) => Math.round(((ms - min) / span) * 1000) / 10;

    const byCity = new Map<string, GanttRow>();
    for (const r of rows) {
      const ms = toMs(r.eventDate);
      if (!Number.isFinite(ms)) continue;
      const label =
        r.crawlName?.trim() ||
        `${String(r.dayPart ?? "crawl").replace(/_/g, " ")} ${r.crawlNumber ?? ""} · ${r.cityName}`;
      const row = byCity.get(r.cityName) ?? { cityName: r.cityName, items: [] };
      row.items.push({
        eventId: r.eventId,
        label: label.trim(),
        dateLabel: LABEL_FMT.format(new Date(ms)),
        offsetPct: pct(ms),
      });
      byCity.set(r.cityName, row);
    }

    // Weekly ticks across the range (capped so the axis stays readable).
    const ticks: GanttAxisTick[] = [];
    const stepMs = Math.max(7 * DAY_MS, Math.ceil(span / 10 / DAY_MS) * DAY_MS);
    for (let t = min; t <= max; t += stepMs) {
      ticks.push({ label: LABEL_FMT.format(new Date(t)), offsetPct: pct(t) });
    }

    return {
      rows: [...byCity.values()],
      ticks,
      rangeLabel: `${LABEL_FMT.format(new Date(min))} – ${LABEL_FMT.format(new Date(max))}`,
    };
  } catch (err) {
    logger.error({ err }, "loadCrawlGantt failed");
    return empty;
  }
}
