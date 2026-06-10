/**
 * Goal progress computation.
 *
 * Given a goal (scope, metric, target_value, period), compute the current
 * value by aggregating the relevant table over the period.
 *
 * Combinations supported:
 *
 *  metric            | scope            | aggregation
 *  ------------------+------------------+--------------------------------
 *  revenue_cents     | campaign         | SUM(city_campaigns.current_sales_cents) for that campaign
 *  revenue_cents     | city_campaign    | city_campaigns.current_sales_cents for that single row
 *  venue_count       | campaign         | COUNT(venue_events confirmed) joined back to campaign
 *  venue_count       | city_campaign    | COUNT(venue_events confirmed) for events in that city_campaign
 *  emails_sent       | outreach_brand   | COUNT(outreach_log where channel=email AND outreach_brand=scopeId AND created BETWEEN period)
 *  emails_sent       | staff_weekly     | COUNT(outreach_log where channel=email AND staff_member=scopeId AND created BETWEEN period)
 *  calls_made        | outreach_brand   | same as above with channel=call
 *  calls_made        | staff_weekly     | same as above with channel=call
 *  confirmations     | campaign         | COUNT(venue_events confirmed AND confirmed_at BETWEEN period)
 *  confirmations     | staff_weekly     | COUNT(venue_events confirmed_by=scopeId AND confirmed_at BETWEEN period)
 *  replies_received  | outreach_brand   | COUNT(outreach_log where outcome in engagement set AND outreach_brand=scopeId)
 *  replies_received  | staff_weekly     | similar with staff_member
 *
 * Combinations not in this list return current=0, applicable=false so the
 * UI can render "—" / "n/a".
 */

import { cityCampaigns, outreachLog } from "@/db/schema";
import { db } from "@/lib/db";
import { and, eq, gte, lte, sql } from "drizzle-orm";

export interface GoalRow {
  id: string;
  scope: "campaign" | "outreach_brand" | "crawl_brand" | "city_campaign" | "staff_weekly";
  scopeId: string;
  metric:
    | "revenue_cents"
    | "venue_count"
    | "emails_sent"
    | "calls_made"
    | "confirmations"
    | "replies_received";
  targetValue: bigint;
  periodStart: string;
  periodEnd: string;
}

export interface GoalProgress {
  /** Current aggregated value in DB units (cents for revenue, count otherwise). */
  current: number;
  /** Whether the (metric, scope) combination is currently supported. */
  applicable: boolean;
  /** 0-100, clamped. Zero when target_value is 0 to avoid divide-by-zero. */
  pct: number;
}

export async function computeGoalProgress(goal: GoalRow): Promise<GoalProgress> {
  const target = Number(goal.targetValue);
  const periodStart = `${goal.periodStart}T00:00:00Z`;
  const periodEnd = `${goal.periodEnd}T23:59:59Z`;

  let current = 0;
  let applicable = true;

  // ---- revenue_cents ----
  if (goal.metric === "revenue_cents") {
    if (goal.scope === "campaign") {
      const result = await db
        .select({
          total: sql<number>`COALESCE(SUM(${cityCampaigns.currentSalesCents}), 0)::bigint`,
        })
        .from(cityCampaigns)
        .where(eq(cityCampaigns.campaignId, goal.scopeId));
      current = Number(result[0]?.total ?? 0);
    } else if (goal.scope === "city_campaign") {
      const result = await db
        .select({ amount: cityCampaigns.currentSalesCents })
        .from(cityCampaigns)
        .where(eq(cityCampaigns.id, goal.scopeId))
        .limit(1);
      current = Number(result[0]?.amount ?? 0);
    } else {
      applicable = false;
    }
  }

  // ---- venue_count (confirmed venue_events) ----
  else if (goal.metric === "venue_count") {
    if (goal.scope === "campaign") {
      // Join venue_events → events → city_campaigns to filter by campaign
      const result = await db.execute<{ count: number }>(sql`
        SELECT COUNT(*)::int AS count
        FROM venue_events ve
        JOIN events e ON e.id = ve.event_id
        JOIN city_campaigns cc ON cc.id = e.city_campaign_id
        WHERE cc.campaign_id = ${goal.scopeId}
          AND ve.status = 'confirmed'
      `);
      const list = Array.isArray(result)
        ? result
        : ((result as unknown as { rows: Array<{ count: number }> }).rows ?? []);
      current = Number(list[0]?.count ?? 0);
    } else if (goal.scope === "city_campaign") {
      const result = await db.execute<{ count: number }>(sql`
        SELECT COUNT(*)::int AS count
        FROM venue_events ve
        JOIN events e ON e.id = ve.event_id
        WHERE e.city_campaign_id = ${goal.scopeId}
          AND ve.status = 'confirmed'
      `);
      const list = Array.isArray(result)
        ? result
        : ((result as unknown as { rows: Array<{ count: number }> }).rows ?? []);
      current = Number(list[0]?.count ?? 0);
    } else {
      applicable = false;
    }
  }

  // ---- emails_sent / calls_made / confirmations / replies_received from outreach_log ----
  else if (
    goal.metric === "emails_sent" ||
    goal.metric === "calls_made" ||
    goal.metric === "replies_received"
  ) {
    // Channel values must match the outreach_channel ENUM ('call', not
    // 'phone' -- the old literal made calls_made goals always count 0).
    const channel =
      goal.metric === "emails_sent" ? "email" : goal.metric === "calls_made" ? "call" : null; // replies_received doesn't filter by channel

    const scopeFilter =
      goal.scope === "outreach_brand"
        ? eq(outreachLog.outreachBrandId, goal.scopeId)
        : goal.scope === "staff_weekly"
          ? eq(outreachLog.staffMemberId, goal.scopeId)
          : null;

    if (!scopeFilter) {
      applicable = false;
    } else {
      const outcomeFilter =
        goal.metric === "replies_received"
          ? sql`${outreachLog.outcome} IN ('interested','confirmed','callback_requested','declined')`
          : goal.metric === "emails_sent"
            ? // Provenance rows (address collected, nothing sent) must not
              // count toward email-send goals.
              sql`${outreachLog.outcome} <> 'email_collected'`
            : null;
      const channelFilter = channel ? sql`${outreachLog.channel} = ${channel}` : null;

      const result = await db
        .select({
          count: sql<number>`COUNT(*)::int`,
        })
        .from(outreachLog)
        .where(
          and(
            scopeFilter,
            channelFilter ?? undefined,
            outcomeFilter ?? undefined,
            gte(outreachLog.createdAt, new Date(periodStart)),
            lte(outreachLog.createdAt, new Date(periodEnd)),
          ),
        );
      current = Number(result[0]?.count ?? 0);
    }
  }

  // ---- confirmations (venue_events confirmed in period) ----
  else if (goal.metric === "confirmations") {
    if (goal.scope === "campaign") {
      const result = await db.execute<{ count: number }>(sql`
        SELECT COUNT(*)::int AS count
        FROM venue_events ve
        JOIN events e ON e.id = ve.event_id
        JOIN city_campaigns cc ON cc.id = e.city_campaign_id
        WHERE cc.campaign_id = ${goal.scopeId}
          AND ve.status = 'confirmed'
          AND ve.confirmed_at >= ${periodStart}
          AND ve.confirmed_at <= ${periodEnd}
      `);
      const list = Array.isArray(result)
        ? result
        : ((result as unknown as { rows: Array<{ count: number }> }).rows ?? []);
      current = Number(list[0]?.count ?? 0);
    } else if (goal.scope === "city_campaign") {
      const result = await db.execute<{ count: number }>(sql`
        SELECT COUNT(*)::int AS count
        FROM venue_events ve
        JOIN events e ON e.id = ve.event_id
        WHERE e.city_campaign_id = ${goal.scopeId}
          AND ve.status = 'confirmed'
          AND ve.confirmed_at >= ${periodStart}
          AND ve.confirmed_at <= ${periodEnd}
      `);
      const list = Array.isArray(result)
        ? result
        : ((result as unknown as { rows: Array<{ count: number }> }).rows ?? []);
      current = Number(list[0]?.count ?? 0);
    } else {
      // confirmations per staff_weekly requires a confirmed_by_staff_id
      // column that venue_events doesn't have yet — would need a schema
      // change. Until then, mark not applicable.
      applicable = false;
    }
  }

  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  return { current, applicable, pct };
}
