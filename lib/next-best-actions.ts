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
  | "unassigned_lead"
  // v2 (2026-06-11 best-in-class audit): the operating-brain categories.
  | "replacement_urgent"
  | "high_sales_missing_final"
  | "v2_call_due"
  | "warm_reply_waiting"
  | "lifecycle_blocker";

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
  /** The city this action belongs to (null = campaign-wide). Drives the
   *  per-viewer personalization below. */
  cityCampaignId: string | null;
}

const MAX_ITEMS = 8;

export async function loadNextBestActions(
  campaignId: string | null,
  /** Personalize to this staffer's assigned cities (operator request
   *  2026-06-10 -- the list was identical for everyone). */
  viewerStaffId?: string,
): Promise<NextBestAction[]> {
  if (!campaignId) return [];

  const [
    needs,
    stale,
    noTimes,
    confirmedMissing,
    unassigned,
    replacements,
    highSales,
    v2Calls,
    warmReplies,
    blockers,
  ] = await Promise.all([
    loadNeedsVenues(campaignId),
    loadStaleOutreach(campaignId),
    loadMissingTimes(campaignId),
    loadConfirmedMissingInfo(campaignId),
    loadUnassignedLeads(campaignId),
    loadReplacementUrgent(campaignId),
    loadHighSalesMissingFinal(campaignId),
    loadV2CallsDue(campaignId),
    loadWarmRepliesWaiting(campaignId),
    loadLifecycleBlockers(campaignId),
  ]);

  let all = [
    ...replacements,
    ...highSales,
    ...v2Calls,
    ...warmReplies,
    ...blockers,
    ...needs,
    ...stale,
    ...noTimes,
    ...confirmedMissing,
    ...unassigned,
  ];
  // Sort by priority desc; tie-break stable (insertion order) so within
  // a category the most relevant row stays on top.
  all.sort((a, b) => b.priority - a.priority);

  // Personalization: actions on a city ASSIGNED TO SOMEONE ELSE are that
  // person's work -- drop them for this viewer. Keep the viewer's own
  // cities (surfaced first), unassigned cities (fair game -- includes every
  // "assign a lead" item) and campaign-wide actions. A staffer with no
  // assigned cities keeps the full team view (nothing personal to scope to).
  if (viewerStaffId) {
    try {
      const result = await db.execute<{ id: string; lead_staff_id: string | null }>(sql`
        SELECT id::text, lead_staff_id::text
        FROM city_campaigns
        WHERE campaign_id = ${campaignId}
      `);
      type Row = { id: string; lead_staff_id: string | null };
      const rows: Row[] = Array.isArray(result)
        ? (result as unknown as Row[])
        : ((result as unknown as { rows: Row[] }).rows ?? []);
      const ownerOf = new Map(rows.map((r) => [r.id, r.lead_staff_id]));
      const mine = new Set(rows.filter((r) => r.lead_staff_id === viewerStaffId).map((r) => r.id));
      if (mine.size > 0) {
        all = all.filter((a) => {
          if (!a.cityCampaignId) return true;
          const owner = ownerOf.get(a.cityCampaignId) ?? null;
          return owner === null || mine.has(a.cityCampaignId);
        });
        // Stable: your own cities first, priority order preserved within
        // each group (Array.prototype.sort is stable).
        all.sort(
          (a, b) =>
            Number(b.cityCampaignId ? mine.has(b.cityCampaignId) : false) -
            Number(a.cityCampaignId ? mine.has(a.cityCampaignId) : false),
        );
      }
    } catch {
      // Personalization is best-effort; the shared list still renders.
    }
  }

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
        -- Ticket COUNT, not payout cents (2026-06-11 audit: labeling
        -- current_sales_cents as "sales" confused revenue vs tickets;
        -- the tracker made the same switch).
        (SELECT COALESCE(SUM(e2.ticket_sales_count), 0)
           FROM events e2
          WHERE e2.city_campaign_id = cc.id AND e2.archived_at IS NULL) AS sales_cents,
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
    LEFT JOIN users sm ON sm.id = o.lead_staff_id
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
    const tickets = Number.parseInt(r.sales_cents, 10) || 0;
    const fragments: string[] = [];
    fragments.push(`${r.city_name} needs ${r.open_slots}+ venues`);
    if (r.lead_staff_name) fragments.push(`assigned to ${r.lead_staff_name}`);
    fragments.push(tickets === 0 ? "0 tickets sold" : `${tickets} tickets sold`);
    return {
      id: `needs_venues:${r.city_campaign_id}`,
      cityCampaignId: r.city_campaign_id,
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
    cityCampaignId: r.city_campaign_id,
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
      cityCampaignId: null,
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
    cityCampaignId: r.city_campaign_id,
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
    cityCampaignId: r.city_campaign_id,
    label: `${r.city_name} has no lead staffer — assign someone before outreach starts`,
    category: "unassigned_lead" as const,
    priority: 65,
    ctaHref: `/city-campaigns/${r.city_campaign_id}`,
    ctaLabel: "Assign lead",
  }));
}

// =========================================================================
// v2 loaders (2026-06-11 best-in-class audit): the operating-brain
// categories — time-critical, with the WHY in every label. Column names
// verified against db/schema/* per CLAUDE.md 12.1.
// =========================================================================

function rowsOf<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

/** replacement_urgent — a venue cancelled within the last 7 days on an
 *  upcoming crawl that is now short. The single most time-critical
 *  state in the system (refdoc 7.16). */
async function loadReplacementUrgent(campaignId: string): Promise<NextBestAction[]> {
  const rows = rowsOf<{
    city_campaign_id: string;
    city_name: string;
    role: string;
    days_until: number;
  }>(
    await db.execute(sql`
      SELECT DISTINCT ON (ve.id)
        cc.id::text AS city_campaign_id,
        c.name AS city_name,
        ve.role::text AS role,
        (e.event_date - CURRENT_DATE)::int AS days_until
      FROM venue_events ve
      JOIN events e ON e.id = ve.event_id
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN cities c ON c.id = cc.city_id
      WHERE cc.campaign_id = ${campaignId}
        AND ve.cancelled_at > NOW() - INTERVAL '7 days'
        AND e.event_date >= CURRENT_DATE
        AND e.archived_at IS NULL
        AND (
          SELECT COUNT(*) FROM venue_events v2
          WHERE v2.event_id = e.id AND v2.status IN ('confirmed', 'contract_signed')
        ) < e.required_venue_count_total
      ORDER BY ve.id, ve.cancelled_at DESC
      LIMIT 3
    `),
  );
  return rows.map((r) => ({
    id: `replacement:${r.city_campaign_id}:${r.role}`,
    cityCampaignId: r.city_campaign_id,
    label: `${r.city_name}: ${r.role.replace(/_/g, " ")} venue cancelled with ${r.days_until} ${r.days_until === 1 ? "day" : "days"} to go — find a replacement NOW`,
    category: "replacement_urgent" as const,
    priority: 98 - Math.min(20, r.days_until),
    ctaHref: `/city-campaigns/${r.city_campaign_id}`,
    ctaLabel: "Replace venue",
  }));
}

/** high_sales_missing_final — tickets are selling but the crawl has no
 *  confirmed final venue. The audit's flagship example of an action
 *  the brain must surface with its numbers. */
async function loadHighSalesMissingFinal(campaignId: string): Promise<NextBestAction[]> {
  const rows = rowsOf<{
    city_campaign_id: string;
    city_name: string;
    tickets: number;
    days_until: number;
  }>(
    await db.execute(sql`
      SELECT
        cc.id::text AS city_campaign_id,
        c.name AS city_name,
        e.ticket_sales_count AS tickets,
        (e.event_date - CURRENT_DATE)::int AS days_until
      FROM events e
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN cities c ON c.id = cc.city_id
      WHERE cc.campaign_id = ${campaignId}
        AND e.archived_at IS NULL
        AND e.event_date >= CURRENT_DATE
        AND e.ticket_sales_count >= 10
        AND e.required_final_count > 0
        AND NOT EXISTS (
          SELECT 1 FROM venue_events ve
          WHERE ve.event_id = e.id
            AND ve.role IN ('final', 'alt_final')
            AND ve.status IN ('confirmed', 'contract_signed')
        )
      ORDER BY e.ticket_sales_count DESC
      LIMIT 3
    `),
  );
  return rows.map((r) => ({
    id: `highsales:${r.city_campaign_id}:${r.days_until}`,
    cityCampaignId: r.city_campaign_id,
    label: `${r.city_name} has ${r.tickets} tickets sold, event in ${r.days_until} days, and NO final venue — lock the final`,
    category: "high_sales_missing_final" as const,
    priority: 90 + Math.min(8, Math.floor(r.tickets / 10)),
    ctaHref: `/city-campaigns/${r.city_campaign_id}`,
    ctaLabel: "Fill final",
  }));
}

/** v2_call_due — confirmed venues inside the 4-day window whose
 *  floor-staff confirmation call has not happened (refdoc 7.14.3a). */
async function loadV2CallsDue(campaignId: string): Promise<NextBestAction[]> {
  const rows = rowsOf<{
    city_campaign_id: string;
    city_name: string;
    n: number;
    days_until: number;
  }>(
    await db.execute(sql`
      SELECT
        cc.id::text AS city_campaign_id,
        c.name AS city_name,
        COUNT(*)::int AS n,
        MIN(e.event_date - CURRENT_DATE)::int AS days_until
      FROM venue_events ve
      JOIN events e ON e.id = ve.event_id
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN cities c ON c.id = cc.city_id
      WHERE cc.campaign_id = ${campaignId}
        AND ve.status IN ('confirmed', 'contract_signed')
        AND ve.cancelled_at IS NULL
        AND ve.floor_staff_call_completed_at IS NULL
        AND e.archived_at IS NULL
        AND e.event_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '4 days'
      GROUP BY cc.id, c.name
      ORDER BY MIN(e.event_date) ASC
      LIMIT 3
    `),
  );
  return rows.map((r) => ({
    id: `v2calls:${r.city_campaign_id}`,
    cityCampaignId: r.city_campaign_id,
    label: `${r.n} floor-staff confirmation ${r.n === 1 ? "call is" : "calls are"} due in ${r.city_name} — event in ${r.days_until} ${r.days_until === 1 ? "day" : "days"}`,
    category: "v2_call_due" as const,
    priority: 92 - Math.min(4, r.days_until),
    ctaHref: "/worklist",
    ctaLabel: "Make the calls",
  }));
}

/** warm_reply_waiting — a venue wrote back and has been waiting 4+
 *  hours. Warm replies left to cool are the cheapest losses in the
 *  funnel (rotting detection applied to replies). */
async function loadWarmRepliesWaiting(campaignId: string): Promise<NextBestAction[]> {
  const rows = rowsOf<{
    thread_id: string;
    city_campaign_id: string | null;
    venue_name: string | null;
    classification: string;
    hours_waiting: number;
  }>(
    await db.execute(sql`
      SELECT
        t.id::text AS thread_id,
        t.city_campaign_id::text AS city_campaign_id,
        v.name AS venue_name,
        t.classification::text AS classification,
        (EXTRACT(EPOCH FROM (NOW() - t.last_inbound_at)) / 3600)::int AS hours_waiting
      FROM email_threads t
      LEFT JOIN venues v ON v.id = t.venue_id
      JOIN city_campaigns cc ON cc.id = t.city_campaign_id
      WHERE cc.campaign_id = ${campaignId}
        AND t.state = 'needs_reply'
        AND t.deleted_at IS NULL
        AND t.classification::text IN ('interested', 'warm', 'question', 'callback_requested')
        AND t.last_inbound_at < NOW() - INTERVAL '4 hours'
      ORDER BY t.last_inbound_at ASC
      LIMIT 4
    `),
  );
  return rows.map((r) => ({
    id: `warmreply:${r.thread_id}`,
    cityCampaignId: r.city_campaign_id,
    label: `${r.venue_name ?? "A venue"} replied ${r.hours_waiting}h ago (${r.classification.replace(/_/g, " ")}) — answer before it goes cold`,
    category: "warm_reply_waiting" as const,
    priority: 75 + Math.min(17, Math.floor(r.hours_waiting / 4)),
    ctaHref: `/inbox/${r.thread_id}`,
    ctaLabel: "Open thread",
  }));
}

/** lifecycle_blocker — pending deliverables (graphics, sheets, posters)
 *  on confirmed venues inside the 14-day window. These block T10/T11
 *  sends, so they rot silently unless surfaced (refdoc 7.3/7.4). */
async function loadLifecycleBlockers(campaignId: string): Promise<NextBestAction[]> {
  const rows = rowsOf<{
    city_campaign_id: string;
    city_name: string;
    deliverable_type: string;
    n: number;
    days_until: number;
  }>(
    await db.execute(sql`
      SELECT
        cc.id::text AS city_campaign_id,
        c.name AS city_name,
        d.deliverable_type::text AS deliverable_type,
        COUNT(*)::int AS n,
        MIN(e.event_date - CURRENT_DATE)::int AS days_until
      FROM crawl_deliverables d
      JOIN venue_events ve ON ve.id = d.venue_event_id
      JOIN events e ON e.id = ve.event_id
      JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      JOIN cities c ON c.id = cc.city_id
      WHERE cc.campaign_id = ${campaignId}
        AND d.status = 'pending'
        AND ve.status IN ('confirmed', 'contract_signed')
        AND ve.cancelled_at IS NULL
        AND e.archived_at IS NULL
        AND e.event_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'
      GROUP BY cc.id, c.name, d.deliverable_type
      ORDER BY MIN(e.event_date) ASC
      LIMIT 3
    `),
  );
  return rows.map((r) => ({
    id: `blocker:${r.city_campaign_id}:${r.deliverable_type}`,
    cityCampaignId: r.city_campaign_id,
    label: `${r.n} ${r.deliverable_type.replace(/_/g, " ")} ${r.n === 1 ? "deliverable is" : "deliverables are"} pending in ${r.city_name} — event in ${r.days_until} ${r.days_until === 1 ? "day" : "days"}, lifecycle emails are blocked`,
    category: "lifecycle_blocker" as const,
    priority: 84 - Math.min(10, r.days_until),
    ctaHref: `/city-campaigns/${r.city_campaign_id}`,
    ctaLabel: "Clear blockers",
  }));
}
