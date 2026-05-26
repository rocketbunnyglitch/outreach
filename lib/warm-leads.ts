/**
 * Warm lead resurfacing.
 *
 * When the operator is about to start outreach for a new city_campaign,
 * the engine should remember which venues said yes (or maybe-next-time)
 * in past campaigns. Two queries here:
 *
 *   1. Venues confirmed in PAST campaigns in the same city
 *   2. Venues with positive outreach outcomes (interested, confirmed)
 *      from past touchpoints, even if they didn't get confirmed
 *
 * These let the operator click "auto-add to outreach list" instead of
 * starting from a cold cluster.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface WarmLeadRow {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  /** How many past campaigns this venue was confirmed in. */
  pastConfirmedCount: number;
  /** Highest positive outreach outcome we've seen, or null. */
  bestOutreachOutcome: string | null;
  /** When the last positive touchpoint occurred. */
  lastPositiveAt: Date | null;
  /** Whether they're currently set to DNC (filtered out by default but surfaced for context). */
  doNotContact: boolean;
}

/**
 * Find warm leads for a city — venues that have either been confirmed in
 * past campaigns OR had positive outreach outcomes.
 *
 * Excludes venues already in the current city_campaign's pipeline (they're
 * already being worked) and venues set to DNC.
 *
 * `excludeCampaignId` skips matches from the campaign the operator is
 * currently building — we want history from OTHER campaigns, not the one
 * being assembled.
 */
export async function findWarmLeads(opts: {
  cityId: string;
  excludeCampaignId?: string | null;
  limit?: number;
}): Promise<WarmLeadRow[]> {
  const { cityId, excludeCampaignId = null, limit = 50 } = opts;

  const rows = await db.execute<{
    id: string;
    name: string;
    address: string | null;
    email: string | null;
    past_confirmed_count: number;
    best_outreach_outcome: string | null;
    last_positive_at: Date | null;
    do_not_contact: boolean;
  }>(sql`
    WITH past_confirmations AS (
      -- Venues confirmed for past events in this city, excluding current campaign
      SELECT
        ve.venue_id,
        COUNT(*)::int AS confirmed_count
      FROM venue_events ve
      INNER JOIN events e ON e.id = ve.event_id
      INNER JOIN city_campaigns cc ON cc.id = e.city_campaign_id
      WHERE cc.city_id = ${cityId}
        AND ve.status = 'confirmed'
        ${excludeCampaignId ? sql`AND cc.campaign_id != ${excludeCampaignId}` : sql``}
      GROUP BY ve.venue_id
    ),
    past_positive_outreach AS (
      -- Most recent positive outreach touchpoint per venue
      SELECT DISTINCT ON (ol.venue_id)
        ol.venue_id,
        ol.outcome AS best_outcome,
        ol.created_at AS last_positive_at
      FROM outreach_log ol
      INNER JOIN venues v ON v.id = ol.venue_id
      WHERE v.city_id = ${cityId}
        AND ol.outcome IN ('interested', 'confirmed', 'callback_requested')
      ORDER BY ol.venue_id, ol.created_at DESC
    )
    SELECT
      v.id,
      v.name,
      v.address,
      v.email,
      COALESCE(pc.confirmed_count, 0) AS past_confirmed_count,
      ppo.best_outcome AS best_outreach_outcome,
      ppo.last_positive_at,
      v.do_not_contact
    FROM venues v
    LEFT JOIN past_confirmations pc ON pc.venue_id = v.id
    LEFT JOIN past_positive_outreach ppo ON ppo.venue_id = v.id
    WHERE v.city_id = ${cityId}
      AND v.archived_at IS NULL
      AND v.do_not_contact = false
      AND (pc.confirmed_count > 0 OR ppo.best_outcome IS NOT NULL)
    ORDER BY
      COALESCE(pc.confirmed_count, 0) DESC,
      ppo.last_positive_at DESC NULLS LAST,
      v.name ASC
    LIMIT ${limit}
  `);

  // db.execute returns either an array or { rows: [...] } depending on driver.
  // Normalize without using  (biome rule).
  type Row = {
    id: string;
    name: string;
    address: string | null;
    email: string | null;
    past_confirmed_count: number;
    best_outreach_outcome: string | null;
    last_positive_at: Date | null;
    do_not_contact: boolean;
  };
  const list: Row[] = Array.isArray(rows)
    ? (rows as unknown as Row[])
    : ((rows as unknown as { rows: Row[] }).rows ?? []);

  return list.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    email: r.email,
    pastConfirmedCount: Number(r.past_confirmed_count),
    bestOutreachOutcome: r.best_outreach_outcome,
    lastPositiveAt: r.last_positive_at ? new Date(r.last_positive_at) : null,
    doNotContact: r.do_not_contact,
  }));
}
