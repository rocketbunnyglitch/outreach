/**
 * loadCityCampaignProgress — for a campaign id, returns rich per-city
 * progress used by the CityProgressCard on /campaigns/[id].
 *
 * For each city campaign we compute:
 *   - The list of upcoming (non-archived, future) crawls with their
 *     required slot mix + the state of each filled slot
 *   - Cold-outreach pipeline counts (cold / warm / verbal / etc)
 *   - Days until the soonest event
 *   - A composite risk level (low/medium/high/critical) per the
 *     operator-defined formula
 *
 * One query bundles event + venue_event so we don't N+1. The pipeline
 * counts use a second per-campaign aggregate.
 */

import "server-only";

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

/** Status of a single role slot in a single crawl. The values are the
    operator-described palette mapped from the schema's enums:
      schema venueEventStatus 'confirmed' or 'contract_signed' → 'confirmed'
      'interested' or 'negotiating'                            → 'verbal'  (interpreted as "warmer than lead/contacted")
      'contacted' or 'lead'                                    → 'warm'    (some kind of touch logged)
      no venue_event in this slot at all                       → 'empty'
      cold-outreach exists but no venue_event yet              → 'cold'  */
// ---------------------------------------------------------------------------
// Client-safe types + the pure pipelineHealthFor helper live in
// ./city-progress-shared so client components (e.g. CityProgressCard) can
// import them WITHOUT pulling this server-only module (db, sql) into the
// browser bundle. Re-exported here so existing import paths keep working.
// ---------------------------------------------------------------------------
export * from "./city-progress-shared";
import type {
  CityCrawl,
  CityProgressRow,
  CityRisk,
  CitySlot,
  SlotState,
} from "./city-progress-shared";

// =========================================================================
// Risk computation — composite of slot, pipeline, time, with priority
// as an amplifier.
// =========================================================================

function slotRiskOf(row: CityProgressRow): CityRisk {
  // Across all upcoming crawls.
  const confirmedSlots = row.pipeline.totalSlots - row.pipeline.openSlots;
  const total = row.pipeline.totalSlots;
  if (total === 0) return "low"; // nothing scheduled, can't be at risk

  const ratio = confirmedSlots / total;
  if (ratio >= 0.85) return "low";
  if (ratio >= 0.5) return "medium";
  if (ratio >= 0.25) return "high";
  return "critical";
}

function pipelineRiskOf(row: CityProgressRow): CityRisk {
  const p = row.pipeline;
  if (p.openSlots === 0) return "low";
  const supply = p.warm + p.verbal;
  if (supply >= p.openSlots * 2) return "low";
  if (supply >= p.openSlots) return "medium";
  if (supply + p.cold >= p.openSlots) return "high";
  return "critical";
}

function timePressureRiskOf(row: CityProgressRow): CityRisk {
  const days = row.soonestEventDays;
  if (days == null) return "low";
  // Open slots and time pressure interact — only flag when both
  if (row.pipeline.openSlots === 0) return "low";
  if (days < 7) return "critical";
  if (days < 14) return "high";
  if (days < 30) return "medium";
  return "low";
}

const RISK_ORDER: CityRisk[] = ["low", "medium", "high", "critical"];

function bumpRisk(r: CityRisk, steps: number): CityRisk {
  const i = RISK_ORDER.indexOf(r);
  const next = Math.min(RISK_ORDER.length - 1, Math.max(0, i + steps));
  return RISK_ORDER[next] ?? r;
}

function maxRisk(...rs: CityRisk[]): CityRisk {
  let best: CityRisk = "low";
  for (const r of rs) {
    if (RISK_ORDER.indexOf(r) > RISK_ORDER.indexOf(best)) best = r;
  }
  return best;
}

function computeRisk(row: CityProgressRow): CityRisk {
  const base = maxRisk(slotRiskOf(row), pipelineRiskOf(row), timePressureRiskOf(row));
  // Priority modifier:
  //   P1: bump up one level (max critical)
  //   P2: no change
  //   P3-P5: dampen one level UNLESS already critical
  //   P6+: dampen two levels UNLESS already critical
  if (row.priority === 1) return bumpRisk(base, 1);
  if (row.priority === 2) return base;
  if (base === "critical") return base;
  if (row.priority <= 5) return bumpRisk(base, -1);
  return bumpRisk(base, -2);
}

// =========================================================================
// Data fetch
// =========================================================================

export async function loadCityCampaignProgress(campaignId: string): Promise<CityProgressRow[]> {
  type Row = {
    city_campaign_id: string;
    city_name: string;
    city_region: string | null;
    priority: number;
    status: string;
    target_venue_count: number;
    sales_goal_cents: string | null;
    lead_staff_name: string | null;
    // serialized aggregated arrays via json_agg
    crawls_json: string | null;
    pipeline_json: string | null;
    soonest_days: number | null;
  };

  // Build one CTE per city campaign that:
  //   - aggregates every upcoming crawl's slot states into json
  //   - aggregates the cold-outreach pipeline tallies into json
  //   - selects the soonest upcoming event_date
  // We use SECURITY DEFINER-style raw SQL because Drizzle's relational
  // query builder gets noisy with this many sub-aggregates.
  const result = await db.execute<Row>(sql`
    WITH base AS (
      SELECT
        cc.id   AS city_campaign_id,
        c.name  AS city_name,
        c.region AS city_region,
        cc.priority,
        cc.status::text AS status,
        cc.target_venue_count,
        cc.sales_goal_cents::text AS sales_goal_cents,
        sm.display_name AS lead_staff_name
      FROM city_campaigns cc
      JOIN cities c ON c.id = cc.city_id
      LEFT JOIN users sm ON sm.id = cc.lead_staff_id
      WHERE cc.campaign_id = ${campaignId}
        AND cc.archived_at IS NULL
    ),
    crawl_slots AS (
      SELECT
        e.id              AS event_id,
        e.city_campaign_id,
        e.event_date,
        e.day_part::text  AS day_part,
        e.crawl_number,
        e.required_wristband_count,
        e.required_middle_count,
        e.required_final_count,
        (
          SELECT COALESCE(json_agg(json_build_object(
            'role', ve.role::text,
            'position', ve.slot_position,
            'status', ve.status::text,
            'venue_name', v.name,
            'venue_event_id', ve.id
          ) ORDER BY ve.role, ve.slot_position), '[]'::json)
          FROM venue_events ve
          JOIN venues v ON v.id = ve.venue_id
          WHERE ve.event_id = e.id
        ) AS slot_assignments_json
      FROM events e
      WHERE e.archived_at IS NULL
        AND e.event_date >= CURRENT_DATE
    ),
    pipeline AS (
      SELECT
        coe.city_campaign_id,
        COUNT(*) FILTER (WHERE coe.status IN ('not_contacted','email_sent','called','voicemail','no_answer','follow_up_due')) AS cold,
        COUNT(*) FILTER (WHERE coe.status IN ('interested')) AS warm,
        0::bigint AS verbal,
        COUNT(*) FILTER (WHERE coe.status IN ('declined','do_not_contact','bad_email','wrong_number')) AS declined
      FROM cold_outreach_entries coe
      WHERE coe.archived_at IS NULL
      GROUP BY coe.city_campaign_id
    )
    SELECT
      b.city_campaign_id,
      b.city_name,
      b.city_region,
      b.priority,
      b.status,
      b.target_venue_count,
      b.sales_goal_cents,
      b.lead_staff_name,
      (
        SELECT json_agg(json_build_object(
          'event_id', cs.event_id,
          'event_date', cs.event_date::text,
          'day_part', cs.day_part,
          'crawl_number', cs.crawl_number,
          'required_wristband', cs.required_wristband_count,
          'required_middle', cs.required_middle_count,
          'required_final', cs.required_final_count,
          'slot_assignments', cs.slot_assignments_json,
          'days_until', (cs.event_date - CURRENT_DATE)::int
        ) ORDER BY cs.event_date ASC)
        FROM crawl_slots cs
        WHERE cs.city_campaign_id = b.city_campaign_id
      )::text AS crawls_json,
      json_build_object(
        'cold', COALESCE(pl.cold, 0),
        'warm', COALESCE(pl.warm, 0),
        'declined', COALESCE(pl.declined, 0)
      )::text AS pipeline_json,
      (
        SELECT (MIN(cs.event_date) - CURRENT_DATE)::int
        FROM crawl_slots cs
        WHERE cs.city_campaign_id = b.city_campaign_id
      ) AS soonest_days
    FROM base b
    LEFT JOIN pipeline pl ON pl.city_campaign_id = b.city_campaign_id
    ORDER BY b.priority ASC, b.city_name ASC
  `);

  const rows: Row[] = Array.isArray(result)
    ? (result as unknown as Row[])
    : ((result as unknown as { rows: Row[] }).rows ?? []);

  return rows.map((r) => {
    const crawlsRaw = r.crawls_json ? (JSON.parse(r.crawls_json) as RawCrawl[]) : [];
    const pipelineRaw = r.pipeline_json
      ? (JSON.parse(r.pipeline_json) as { cold: number; warm: number; declined: number })
      : { cold: 0, warm: 0, declined: 0 };

    const crawls: CityCrawl[] = crawlsRaw.map((rc) => buildCrawl(rc));

    // Pipeline open-slot count is computed from the crawls so it stays
    // in sync with the slot bar
    let openSlots = 0;
    let totalSlots = 0;
    let verbalCount = 0; // verbal lives on venue_events, not cold_outreach
    for (const c of crawls) {
      for (const s of c.slots) {
        totalSlots++;
        if (s.state === "empty" || s.state === "cold" || s.state === "warm") openSlots++;
        if (s.state === "verbal") verbalCount++;
      }
    }

    const row: CityProgressRow = {
      cityCampaignId: r.city_campaign_id,
      cityName: r.city_name,
      cityRegion: r.city_region,
      priority: r.priority,
      status: r.status,
      targetVenueCount: r.target_venue_count,
      leadStaffName: r.lead_staff_name,
      salesGoalCents: r.sales_goal_cents ? BigInt(r.sales_goal_cents) : null,
      crawls,
      pipeline: {
        cold: pipelineRaw.cold ?? 0,
        warm: pipelineRaw.warm ?? 0,
        verbal: verbalCount,
        declined: pipelineRaw.declined ?? 0,
        openSlots,
        totalSlots,
      },
      soonestEventDays: r.soonest_days,
      risk: "low", // computed below
    };
    row.risk = computeRisk(row);
    return row;
  });
}

// =========================================================================
// Raw → typed crawl shaper
// =========================================================================

interface RawCrawl {
  event_id: string;
  event_date: string;
  day_part: string | null;
  crawl_number: number | null;
  required_wristband: number;
  required_middle: number;
  required_final: number;
  days_until: number;
  slot_assignments: Array<{
    role: string;
    position: number | null;
    status: string;
    venue_name: string;
    venue_event_id: string;
  }>;
}

/** Map venue_event_status enum → display SlotState. */
function statusToState(status: string): SlotState {
  switch (status) {
    case "confirmed":
    case "contract_signed":
      return "confirmed";
    case "interested":
    case "negotiating":
      return "verbal";
    case "contacted":
      return "warm";
    case "lead":
      return "cold";
    case "declined":
    case "cancelled":
      return "declined";
    default:
      return "cold";
  }
}

function buildCrawl(raw: RawCrawl): CityCrawl {
  // Build out the slot positions per role required. If a venue_event
  // exists for that role+position, it fills the slot; otherwise empty.
  const assignByKey = new Map<string, RawCrawl["slot_assignments"][number]>();
  for (const a of raw.slot_assignments ?? []) {
    assignByKey.set(`${a.role}:${a.position ?? 1}`, a);
  }

  const slots: CitySlot[] = [];
  const roles: Array<{ role: "wristband" | "middle" | "final"; count: number }> = [
    { role: "wristband", count: raw.required_wristband },
    { role: "middle", count: raw.required_middle },
    { role: "final", count: raw.required_final },
  ];

  for (const { role, count } of roles) {
    for (let pos = 1; pos <= count; pos++) {
      const a = assignByKey.get(`${role}:${pos}`);
      if (a) {
        slots.push({
          role,
          position: pos,
          state: statusToState(a.status),
          venueName: a.venue_name,
          venueEventId: a.venue_event_id,
        });
      } else {
        slots.push({ role, position: pos, state: "empty", venueName: null, venueEventId: null });
      }
    }
  }

  return {
    eventId: raw.event_id,
    eventDate: raw.event_date,
    dayPart: raw.day_part,
    crawlNumber: raw.crawl_number,
    requiredWristband: raw.required_wristband,
    requiredMiddle: raw.required_middle,
    requiredFinal: raw.required_final,
    slots,
    daysUntil: raw.days_until,
  };
}
