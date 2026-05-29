/**
 * Next Best Actions — a list of "what should I actually do next?"
 * items surfaced on the dashboard's Today section.
 *
 * The Today digest tells the operator WHAT IS HAPPENING (urgent
 * crawls, stale follow-ups, recent wins). Next Best Actions tells
 * them WHAT TO DO ABOUT IT — concrete next steps with a CTA link.
 *
 * Categories (each contributes 0–N items, capped overall):
 *
 *   1. needs_venues  — city_campaigns with 3+ open slots in events
 *      ≤30 days away. Action: start outreach.
 *
 *   2. stale_outreach — cold_outreach_entries last touched >14 days
 *      ago in a non-terminal status, aggregated by city. Action:
 *      refresh the venue list.
 *
 *   3. missing_times — events with a date but no starts_at / ends_at.
 *      Action: fix before support totals are computed.
 *
 *   4. confirmed_missing_info — venue_events with status='confirmed'
 *      whose venue is missing phone, email, hours, or capacity.
 *      Action: collect operational data so support staff aren't
 *      hunting for it the night-of.
 *
 *   5. unassigned_lead — city_campaigns with open slots and no lead
 *      staffer. Action: assign a lead so the workload balancer
 *      stops spinning.
 *
 * Priority ordering:
 *   - Imminent crawls > distant crawls (days_until ASC)
 *   - Higher open-slot counts > lower (need 4 > need 1)
 *   - missing_times + unassigned_lead bubble up because they block
 *     downstream automation
 *
 * Total capped at 8 items so the section stays glance-able. The
 * dashboard renders these as a numbered list — each item is a
 * single, declarative sentence ending with a verb the operator can
 * act on.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export type ActionCategory =
  | "needs_venues"
  | "stale_outreach"
  | "missing_times"
  | "confirmed_missing_info"
  | "unassigned_lead";

export interface NextBestAction {
  id: string;
  /** One-line declarative sentence ending with the imperative verb. */
  label: string;
  category: ActionCategory;
  /** Internal priority — higher = surface first. Range 0..100. */
  priority: number;
  /** Deep-link destination; null = no direct route (rare). */
  ctaHref: string | null;
  /** Short CTA label e.g. "Open city" / "Add times" / "Assign lead". */
  ctaLabel: string;
}

const MAX_ITEMS = 8;

export async function loadNextBestActions(campaignId: string | null): Promise<NextBestAction[]> {
  if (!campaignId) return [];

  const [needs, stale, noTimes, confirmedMissing, unassigned] = await Promise.all([
    loadNeedsVenues(campaignId),
    loadStaleOutreach(campaignId),
    loadMissingTimes(campaignId),
    loadConfirmedMissingInfo(campaignId),
    loadUnassignedLeads(campaignId),
  ]);

  const all = [...needs, ...stale, ...noTimes, ...confirmedMissing, ...unassigned];
  // Sort by priority desc; tie-break stable (insertion order) so within
  // a category the most relevant row stays on top.
  all.sort((a, b) => b.priority - a.priority);
  return all.slice(0, MAX_ITEMS);
}

// =========================================================================
// 1. needs_venues — open slots in upcoming events
// =========================================================================
async function loadNeedsVenues(campaignId: string): Promise<NextBestAction[]> {
  const rows = await db.execute<{
    city_campaign_id: string;
    city_name: string;
    open_slots: number;
    lead_staff_name: string | null;
    sales_cents: string;
    days_until_min: number;
  }>(sql`
    WITH open_per_cc AS (
      SELECT
        cc.id AS city_campaign_id,
        cc.lead_staff_id,
        cc.current_sales_cents AS sales_cents,
        c.name AS city_name,
        MIN(e.event_date - CURRENT_DATE) AS days_until_min,
        SUM(
          GREATEST(
            0,
            e.required_venue_count_total - COALESCE((
              SELECT COUNT(*) FROM venue_events ve
               WHERE ve.event_id = e.id
                 AND ve.status IN ('confirmed', 'contract_signed')
            ), 0)
          )
        )::int AS open_slots
      FROM city_campaigns cc
      JOIN cities c ON c.id = cc.city_id
      JOIN events e ON e.city_campaign_id = cc.id
      WHERE cc.campaign_id = ${campaignId}
        AND cc.status != 'cancelled'
        AND e.event_date >= CURRENT_DATE
        AND e.event_date <= CURRENT_DATE + INTERVAL '30 days'
      GROUP BY cc.id, c.name, cc.lead_staff_id, cc.current_sales_cents
    )
    SELECT
      o.city_campaign_id::text,
      o.city_name,
      o.open_slots,
      o.sales_cents::text,
      o.days_until_min,
      sm.display_name AS lead_staff_name
    FROM open_per_cc o
    LEFT JOIN staff_members sm ON sm.id = o.lead_staff_id
    WHERE o.open_slots >= 3
    ORDER BY o.days_until_min ASC, o.open_slots DESC
    LIMIT 4
  `);

  type Row = {
    city_campaign_id: string;
    city_name: string;
    open_slots: number;
    lead_staff_name: string | null;
    sales_cents: string;
    days_until_min: number;
  };
  const list: Row[] = Array.isArray(rows)
    ? (rows as unknown as Row[])
    : ((rows as unknown as { rows: Row[] }).rows ?? []);

  return list.map((r) => {
    const sales = Number.parseInt(r.sales_cents, 10) || 0;
    const fragments: string[] = [];
    fragments.push(`${r.city_name} needs ${r.open_slots}+ venues`);
    if (r.lead_staff_name) fragments.push(`assigned to ${r.lead_staff_name}`);
    fragments.push(sales === 0 ? "0 sales" : `$${Math.round(sales / 100)} sales`);
    return {
      id: `needs_venues:${r.city_campaign_id}`,
      label: `${fragments.join(" — ")} — start outreach`,
      category: "needs_venues" as const,
      // Imminent crawls + bigger gaps surface first
      priority: 80 + Math.max(0, 30 - r.days_until_min) + Math.min(10, r.open_slots),
      ctaHref: `/city-campaigns/${r.city_campaign_id}`,
      ctaLabel: "Open city",
    };
  });
}

// =========================================================================
// 2. stale_outreach — last touch >14 days ago in non-terminal status
// =========================================================================
async function loadStaleOutreach(campaignId: string): Promise<NextBestAction[]> {
  const rows = await db.execute<{
    city_campaign_id: string;
    city_name: string;
    stale_count: number;
  }>(sql`
    SELECT
      cc.id::text AS city_campaign_id,
      c.name AS city_name,
      COUNT(*)::int AS stale_count
    FROM cold_outreach_entries coe
    JOIN city_campaigns cc ON cc.id = coe.city_campaign_id
    JOIN cities c ON c.id = cc.city_id
    WHERE cc.campaign_id = ${campaignId}
      AND coe.status NOT IN ('declined', 'do_not_contact', 'bad_email', 'wrong_number')
      AND (coe.last_touch_at IS NULL OR coe.last_touch_at < NOW() - INTERVAL '14 days')
    GROUP BY cc.id, c.name
    HAVING COUNT(*) >= 3
    ORDER BY COUNT(*) DESC
    LIMIT 3
  `);

  type Row = {
    city_campaign_id: string;
    city_name: string;
    stale_count: number;
  };
  const list: Row[] = Array.isArray(rows)
    ? (rows as unknown as Row[])
    : ((rows as unknown as { rows: Row[] }).rows ?? []);

  return list.map((r) => ({
    id: `stale_outreach:${r.city_campaign_id}`,
    label: `${r.city_name} outreach may be outdated (${r.stale_count} cold entries untouched 14+ days) — refresh venue list`,
    category: "stale_outreach" as const,
    priority: 60 + Math.min(15, r.stale_count),
    ctaHref: `/city-campaigns/${r.city_campaign_id}`,
    ctaLabel: "Open city",
  }));
}

// =========================================================================
// 3. missing_times — events with date but no start/end
// =========================================================================
async function loadMissingTimes(campaignId: string): Promise<NextBestAction[]> {
  const rows = await db.execute<{ missing_count: number }>(sql`
    SELECT COUNT(*)::int AS missing_count
      FROM events e
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
     WHERE cc.campaign_id = ${campaignId}
       AND e.event_date >= CURRENT_DATE
       AND e.event_date <= CURRENT_DATE + INTERVAL '60 days'
       AND (e.starts_at IS NULL OR e.ends_at IS NULL)
  `);
  type Row = { missing_count: number };
  const list: Row[] = Array.isArray(rows)
    ? (rows as unknown as Row[])
    : ((rows as unknown as { rows: Row[] }).rows ?? []);
  const count = list[0]?.missing_count ?? 0;
  if (count === 0) return [];
  return [
    {
      id: "missing_times:all",
      label: `${count} crawl${count === 1 ? "" : "s"} missing start/end time — fix before support totals`,
      category: "missing_times",
      priority: 70 + Math.min(15, count),
      ctaHref: "/all-crawls",
      ctaLabel: "Add times",
    },
  ];
}

// =========================================================================
// 4. confirmed_missing_info — confirmed venues missing operational data
// =========================================================================
async function loadConfirmedMissingInfo(campaignId: string): Promise<NextBestAction[]> {
  const rows = await db.execute<{
    venue_event_id: string;
    city_campaign_id: string;
    venue_name: string;
    missing: string;
  }>(sql`
    SELECT
      ve.id::text AS venue_event_id,
      cc.id::text AS city_campaign_id,
      v.name AS venue_name,
      ARRAY_TO_STRING(
        ARRAY_REMOVE(
          ARRAY[
            CASE WHEN v.phone_e164 IS NULL THEN 'phone' END,
            CASE WHEN v.email IS NULL THEN 'email' END,
            CASE WHEN v.hours IS NULL THEN 'hours' END,
            CASE WHEN v.capacity IS NULL THEN 'capacity' END
          ],
          NULL
        ),
        ' / '
      ) AS missing
    FROM venue_events ve
    JOIN events e ON e.id = ve.event_id
    JOIN city_campaigns cc ON cc.id = e.city_campaign_id
    JOIN venues v ON v.id = ve.venue_id
    WHERE cc.campaign_id = ${campaignId}
      AND ve.status IN ('confirmed', 'contract_signed')
      AND (v.phone_e164 IS NULL OR v.email IS NULL OR v.hours IS NULL OR v.capacity IS NULL)
    ORDER BY ve.confirmed_at DESC NULLS LAST
    LIMIT 3
  `);
  type Row = {
    venue_event_id: string;
    city_campaign_id: string;
    venue_name: string;
    missing: string;
  };
  const list: Row[] = Array.isArray(rows)
    ? (rows as unknown as Row[])
    : ((rows as unknown as { rows: Row[] }).rows ?? []);

  return list.map((r) => ({
    id: `confirmed_missing_info:${r.venue_event_id}`,
    label: `${r.venue_name} confirmed — add ${r.missing || "contact details"}`,
    category: "confirmed_missing_info" as const,
    priority: 55,
    ctaHref: `/city-campaigns/${r.city_campaign_id}`,
    ctaLabel: "Open city",
  }));
}

// =========================================================================
// 5. unassigned_lead — city_campaigns with open slots and no lead
// =========================================================================
async function loadUnassignedLeads(campaignId: string): Promise<NextBestAction[]> {
  const rows = await db.execute<{
    city_campaign_id: string;
    city_name: string;
  }>(sql`
    SELECT
      cc.id::text AS city_campaign_id,
      c.name AS city_name
    FROM city_campaigns cc
    JOIN cities c ON c.id = cc.city_id
    WHERE cc.campaign_id = ${campaignId}
      AND cc.lead_staff_id IS NULL
      AND cc.status != 'cancelled'
      AND EXISTS (
        SELECT 1 FROM events e
         WHERE e.city_campaign_id = cc.id
           AND e.event_date >= CURRENT_DATE
      )
    ORDER BY c.name
    LIMIT 3
  `);
  type Row = { city_campaign_id: string; city_name: string };
  const list: Row[] = Array.isArray(rows)
    ? (rows as unknown as Row[])
    : ((rows as unknown as { rows: Row[] }).rows ?? []);

  return list.map((r) => ({
    id: `unassigned_lead:${r.city_campaign_id}`,
    label: `${r.city_name} has no lead staffer — assign someone before outreach starts`,
    category: "unassigned_lead" as const,
    priority: 65,
    ctaHref: `/city-campaigns/${r.city_campaign_id}`,
    ctaLabel: "Assign lead",
  }));
}
