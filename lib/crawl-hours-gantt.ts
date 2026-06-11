import "server-only";

/**
 * Data for the interactive HOURS gantt on /crawl-support (operator
 * request, asked three times — never again): for each upcoming crawl,
 * every venue slot as a time-positioned bar.
 *
 * Time source per slot, best first:
 *   1. slot_start_time/slot_end_time (structured columns)
 *   2. agreed_hours_text parsed by the evening-convention parser
 *      (lib/crawl-hours-core — covers "7:30-10:30", "11:30-2:00", ...)
 * Slots with neither (or unparseable text) are listed as "no times" so
 * they're visible work, not hidden rows.
 *
 * Coverage gaps are computed over CONFIRMED bars only — a hole between
 * the wristband close and the next confirmed open is the thing the
 * operator needs to see at a glance.
 */

import {
  type CoverageGap,
  type CrawlSpan,
  crawlMinutesLabel,
  findCoverageGaps,
  parseAgreedHours,
  timeToCrawlMinutes,
} from "@/lib/crawl-hours-core";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface HoursGanttBar {
  venueEventId: string;
  venueId: string;
  venueName: string;
  role: string;
  slotPosition: number | null;
  status: string;
  startMin: number;
  endMin: number;
  startLabel: string;
  endLabel: string;
  /** 'slot_fields' | 'agreed_text' — shown in the tooltip so the operator
   *  knows whether the bar is structured data or parsed prose. */
  source: "slot_fields" | "agreed_text";
}

export interface HoursGanttCrawl {
  eventId: string;
  label: string;
  eventDate: string;
  cityName: string;
  axisStartMin: number;
  axisEndMin: number;
  hourTicks: Array<{ min: number; label: string }>;
  bars: HoursGanttBar[];
  gaps: CoverageGap[];
  /** Confirmed venues with no usable times — visible work. */
  unscheduled: Array<{ venueEventId: string; venueName: string; role: string }>;
}

const ROLE_ORDER: Record<string, number> = { wristband: 0, middle: 1, final: 2, alt_final: 3 };
const DAY_PART_LABEL: Record<string, string> = {
  thursday_night: "Thu Night",
  friday_night: "Fri Night",
  saturday_day: "Sat Day",
  saturday_night: "Sat Night",
  sunday_day: "Sun Day",
  sunday_night: "Sun Night",
  other: "Crawl",
};

type Row = {
  event_id: string;
  event_date: string;
  day_part: string | null;
  crawl_number: number | null;
  city_name: string;
  venue_event_id: string;
  venue_id: string;
  venue_name: string;
  role: string;
  slot_position: number | null;
  status: string;
  slot_start_time: string | null;
  slot_end_time: string | null;
  agreed_hours_text: string | null;
};

function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

export async function loadCrawlHoursGantt(limit = 40): Promise<HoursGanttCrawl[]> {
  const rows = rowsOf<Row>(
    await db.execute(sql`
      SELECT e.id::text AS event_id,
             e.event_date::text AS event_date,
             e.day_part::text AS day_part,
             e.crawl_number::int AS crawl_number,
             c.name AS city_name,
             ve.id::text AS venue_event_id,
             v.id::text AS venue_id,
             v.name AS venue_name,
             ve.role::text AS role,
             ve.slot_position::int AS slot_position,
             ve.status::text AS status,
             ve.slot_start_time::text AS slot_start_time,
             ve.slot_end_time::text AS slot_end_time,
             ve.agreed_hours_text AS agreed_hours_text
      FROM events e
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN cities c ON c.id = cc.city_id
      JOIN venue_events ve ON ve.event_id = e.id
      JOIN venues v ON v.id = ve.venue_id
      WHERE e.archived_at IS NULL
        AND e.event_date >= (now() at time zone 'America/Toronto')::date
        AND ve.status IN ('confirmed', 'negotiating', 'interested')
        AND e.id IN (
          SELECT e2.id FROM events e2
          WHERE e2.archived_at IS NULL
            AND e2.event_date >= (now() at time zone 'America/Toronto')::date
          ORDER BY e2.event_date ASC
          LIMIT ${limit}
        )
      ORDER BY e.event_date ASC, c.name ASC
    `),
  );

  const byEvent = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byEvent.get(r.event_id) ?? [];
    list.push(r);
    byEvent.set(r.event_id, list);
  }

  const crawls: HoursGanttCrawl[] = [];
  for (const [eventId, slots] of byEvent) {
    const first = slots[0] as Row;
    const bars: HoursGanttBar[] = [];
    const unscheduled: HoursGanttCrawl["unscheduled"] = [];

    for (const s of slots) {
      let span: CrawlSpan | null = null;
      let source: HoursGanttBar["source"] = "slot_fields";
      const start = timeToCrawlMinutes(s.slot_start_time);
      const end = timeToCrawlMinutes(s.slot_end_time);
      if (start != null && end != null && end > start) {
        span = { startMin: start, endMin: end };
      } else {
        const parsed = parseAgreedHours(s.agreed_hours_text);
        if (parsed) {
          span = parsed;
          source = "agreed_text";
        }
      }
      if (!span) {
        if (s.status === "confirmed") {
          unscheduled.push({
            venueEventId: s.venue_event_id,
            venueName: s.venue_name,
            role: s.role,
          });
        }
        continue;
      }
      bars.push({
        venueEventId: s.venue_event_id,
        venueId: s.venue_id,
        venueName: s.venue_name,
        role: s.role,
        slotPosition: s.slot_position,
        status: s.status,
        startMin: span.startMin,
        endMin: span.endMin,
        startLabel: crawlMinutesLabel(span.startMin),
        endLabel: crawlMinutesLabel(span.endMin),
        source,
      });
    }

    // A crawl with nothing to draw and nothing unscheduled adds noise — skip.
    if (bars.length === 0 && unscheduled.length === 0) continue;

    bars.sort(
      (a, b) =>
        (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
        (a.slotPosition ?? 0) - (b.slotPosition ?? 0) ||
        a.startMin - b.startMin,
    );

    const mins = bars.map((b) => b.startMin);
    const maxs = bars.map((b) => b.endMin);
    // Default 7pm-2am window when there are no bars yet.
    const axisStartMin = Math.floor((mins.length ? Math.min(...mins) : 19 * 60) / 60) * 60;
    const axisEndMin = Math.ceil((maxs.length ? Math.max(...maxs) : 26 * 60) / 60) * 60;
    const hourTicks: HoursGanttCrawl["hourTicks"] = [];
    for (let m = axisStartMin; m <= axisEndMin; m += 60) {
      hourTicks.push({ min: m, label: crawlMinutesLabel(m) });
    }

    const part = (first.day_part && DAY_PART_LABEL[first.day_part]) || "Crawl";
    const num = first.crawl_number && first.crawl_number > 1 ? ` #${first.crawl_number}` : "";
    crawls.push({
      eventId,
      label: `${first.city_name} · ${part}${num} · ${first.event_date}`,
      eventDate: first.event_date,
      cityName: first.city_name,
      axisStartMin,
      axisEndMin,
      hourTicks,
      bars,
      gaps: findCoverageGaps(
        bars
          .filter((b) => b.status === "confirmed")
          .map((b) => ({
            startMin: b.startMin,
            endMin: b.endMin,
          })),
      ),
      unscheduled,
    });
  }

  return crawls;
}
