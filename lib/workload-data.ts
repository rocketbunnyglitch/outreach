import "server-only";

/**
 * Staff workload + accountability data (CRM plan C3).
 *
 * One row per active staffer: how much is on their plate (open/overdue
 * tasks, needs-reply threads, rotting replies), what they own (cities
 * led + how many of those are at risk), what they cleared in the last
 * 7 days, and a median reply-time proxy over 14 days. Graded by the
 * pure staffWorkloadHealthFromInputs core so the chip + the watchdog
 * vocabulary stay consistent.
 *
 * Deliberately NO venues-confirmed leaderboard: confirmed-count
 * leaderboards incentivize fake confirms (the exact failure the stage
 * gates exist to stop).
 */

import { db } from "@/lib/db";
import { loadCampaignHealth } from "@/lib/health-score";
import { type HealthScore, staffWorkloadHealthFromInputs } from "@/lib/health-score-core";
import { ROT_THRESHOLDS } from "@/lib/rot";
import { sql } from "drizzle-orm";

export interface StaffWorkloadRow {
  staffId: string;
  displayName: string;
  openTasks: number;
  overdueTasks: number;
  needsReplyThreads: number;
  /** Of those, waiting past the warm-reply warn threshold (4h). */
  rottingReplies: number;
  citiesLed: number;
  /** Of those, currently red or yellow. */
  riskyCities: number;
  tasksCleared7d: number;
  /** Median hours from a venue's inbound to our outbound on their
   *  assigned threads, last 14 days. null = no replies in window. */
  medianReplyHours: number | null;
  health: HealthScore;
}

function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}

export async function loadStaffWorkload(campaignId: string | null): Promise<StaffWorkloadRow[]> {
  const warnHours = ROT_THRESHOLDS.warm_reply.warnHours;

  const [staffRows, healthSummary] = await Promise.all([
    db.execute(sql`
      SELECT
        u.id::text AS staff_id,
        u.display_name,
        COALESCE(t.open_tasks, 0)::int AS open_tasks,
        COALESCE(t.overdue_tasks, 0)::int AS overdue_tasks,
        COALESCE(t.cleared_7d, 0)::int AS cleared_7d,
        COALESCE(th.needs_reply, 0)::int AS needs_reply,
        COALESCE(th.rotting, 0)::int AS rotting,
        th.median_reply_hours,
        COALESCE(cc.cities_led, 0)::int AS cities_led
      FROM users u
      LEFT JOIN (
        SELECT
          assigned_staff_id,
          count(*) FILTER (WHERE status IN ('pending', 'in_progress')) AS open_tasks,
          count(*) FILTER (
            WHERE status IN ('pending', 'in_progress') AND due_at < now()
          ) AS overdue_tasks,
          count(*) FILTER (
            WHERE status = 'completed' AND completed_at > now() - interval '7 days'
          ) AS cleared_7d
        FROM tasks
        GROUP BY assigned_staff_id
      ) t ON t.assigned_staff_id = u.id
      LEFT JOIN (
        SELECT
          assigned_staff_id,
          count(*) FILTER (WHERE state = 'needs_reply' AND deleted_at IS NULL) AS needs_reply,
          count(*) FILTER (
            WHERE state = 'needs_reply' AND deleted_at IS NULL
              AND last_inbound_at < now() - (${warnHours} || ' hours')::interval
          ) AS rotting,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (last_outbound_at - last_inbound_at)) / 3600
          ) FILTER (
            WHERE last_outbound_at > last_inbound_at
              AND last_outbound_at > now() - interval '14 days'
          ) AS median_reply_hours
        FROM email_threads
        GROUP BY assigned_staff_id
      ) th ON th.assigned_staff_id = u.id
      LEFT JOIN (
        SELECT lead_staff_id, count(*) AS cities_led
        FROM city_campaigns
        GROUP BY lead_staff_id
      ) cc ON cc.lead_staff_id = u.id
      WHERE u.status = 'active'
      ORDER BY u.display_name
    `),
    loadCampaignHealth(campaignId),
  ]);

  // Risky cities per lead: map city color back to the lead staffer.
  const riskyCcIds = new Set(
    healthSummary.cities.filter((c) => c.health.color !== "green").map((c) => c.cityCampaignId),
  );
  const leadRows = rowsOf<{ lead_staff_id: string | null; cc_id: string }>(
    await db.execute(sql`
      SELECT lead_staff_id::text AS lead_staff_id, id::text AS cc_id
      FROM city_campaigns
      WHERE lead_staff_id IS NOT NULL
    `),
  );
  const riskyByLead = new Map<string, number>();
  for (const r of leadRows) {
    if (!r.lead_staff_id || !riskyCcIds.has(r.cc_id)) continue;
    riskyByLead.set(r.lead_staff_id, (riskyByLead.get(r.lead_staff_id) ?? 0) + 1);
  }

  return rowsOf<{
    staff_id: string;
    display_name: string;
    open_tasks: number;
    overdue_tasks: number;
    cleared_7d: number;
    needs_reply: number;
    rotting: number;
    median_reply_hours: number | null;
    cities_led: number;
  }>(staffRows).map((r) => ({
    staffId: r.staff_id,
    displayName: r.display_name,
    openTasks: Number(r.open_tasks),
    overdueTasks: Number(r.overdue_tasks),
    needsReplyThreads: Number(r.needs_reply),
    rottingReplies: Number(r.rotting),
    citiesLed: Number(r.cities_led),
    riskyCities: riskyByLead.get(r.staff_id) ?? 0,
    tasksCleared7d: Number(r.cleared_7d),
    medianReplyHours:
      r.median_reply_hours == null ? null : Math.round(Number(r.median_reply_hours) * 10) / 10,
    health: staffWorkloadHealthFromInputs({
      openTasks: Number(r.open_tasks),
      overdueTasks: Number(r.overdue_tasks),
    }),
  }));
}
