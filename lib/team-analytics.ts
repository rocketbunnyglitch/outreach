/**
 * Team analytics — per-staff activity rollups.
 *
 * For each active staff member, computes:
 *   • Calls in the window (outreach_log where channel='call')
 *   • Emails sent (channel='email', outcome IN ('sent', 'interested',
 *     'confirmed', 'callback_requested') so bounces/bad_email don't
 *     inflate the count)
 *   • SMS sent (channel='sms', same outcome filter)
 *   • 7-bar daily activity (sum of all channels per day) for the
 *     mini sparkline column
 *
 * Default window is the last 7 days. Caller can override for the
 * /admin/analytics page's date picker (next pass).
 *
 * One SQL query with conditional aggregates so the page loads fast
 * even with 50+ staff and 10k+ log entries.
 *
 * Admin-only — caller MUST gate with requireAdmin() before calling
 * this. The loader doesn't enforce — that's the page's job.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface StaffActivityRow {
  staffId: string;
  displayName: string;
  primaryEmail: string;
  role: string;
  calls: number;
  emailsSent: number;
  smsSent: number;
  totalTouches: number;
  /** Daily totals, length === windowDays, oldest first. */
  daily: number[];
  /** Average per-active-day (excludes zero days). */
  avgPerActiveDay: number;
}

export interface TeamAnalyticsTotals {
  calls: number;
  emailsSent: number;
  smsSent: number;
  totalTouches: number;
  activeStaffCount: number;
}

export interface TeamAnalytics {
  windowDays: number;
  windowStart: string; // ISO date
  windowEnd: string; // ISO date
  rows: StaffActivityRow[];
  totals: TeamAnalyticsTotals;
}

export async function loadTeamAnalytics(
  opts: {
    windowDays?: number;
  } = {},
): Promise<TeamAnalytics> {
  const windowDays = Math.min(Math.max(opts.windowDays ?? 7, 1), 90);

  // One query: join staff_members LEFT outreach_log over the window,
  // aggregate counts + a daily-bucket array for the sparkline.
  const result = await db.execute<{
    staff_id: string;
    display_name: string;
    primary_email: string;
    role: string;
    calls: number;
    emails_sent: number;
    sms_sent: number;
    total_touches: number;
    daily: string; // postgres returns int[] as a string like "{0,1,3,0,5,2,1}"
  }>(sql`
    WITH date_series AS (
      SELECT generate_series(
        (CURRENT_DATE - (${windowDays - 1} || ' days')::interval)::date,
        CURRENT_DATE,
        '1 day'::interval
      )::date AS day
    ),
    log_in_window AS (
      SELECT
        ol.staff_member_id,
        ol.channel::text AS channel,
        ol.outcome::text AS outcome,
        ol.created_at::date AS day
      FROM outreach_log ol
      WHERE ol.created_at >= CURRENT_DATE - (${windowDays - 1} || ' days')::interval
    ),
    per_staff_day AS (
      SELECT
        sm.id AS staff_id,
        ds.day,
        COUNT(liw.staff_member_id) FILTER (
          WHERE liw.channel = 'call'
        )::int AS day_calls,
        COUNT(liw.staff_member_id) FILTER (
          WHERE liw.channel = 'email'
            AND liw.outcome IN ('sent','interested','confirmed','callback_requested')
        )::int AS day_emails,
        COUNT(liw.staff_member_id) FILTER (
          WHERE liw.channel = 'sms'
            AND liw.outcome IN ('sent','interested','confirmed','callback_requested')
        )::int AS day_sms
      FROM staff_members sm
      CROSS JOIN date_series ds
      LEFT JOIN log_in_window liw
        ON liw.staff_member_id = sm.id AND liw.day = ds.day
      WHERE sm.status = 'active'
      GROUP BY sm.id, ds.day
    )
    SELECT
      sm.id AS staff_id,
      sm.display_name,
      sm.primary_email,
      sm.role::text AS role,
      COALESCE(SUM(psd.day_calls), 0)::int AS calls,
      COALESCE(SUM(psd.day_emails), 0)::int AS emails_sent,
      COALESCE(SUM(psd.day_sms), 0)::int AS sms_sent,
      COALESCE(SUM(psd.day_calls + psd.day_emails + psd.day_sms), 0)::int AS total_touches,
      ARRAY_AGG(
        (psd.day_calls + psd.day_emails + psd.day_sms)
        ORDER BY psd.day ASC
      )::text AS daily
    FROM staff_members sm
    LEFT JOIN per_staff_day psd ON psd.staff_id = sm.id
    WHERE sm.status = 'active'
    GROUP BY sm.id, sm.display_name, sm.primary_email, sm.role
    ORDER BY total_touches DESC, sm.display_name ASC
  `);

  type Row = {
    staff_id: string;
    display_name: string;
    primary_email: string;
    role: string;
    calls: number;
    emails_sent: number;
    sms_sent: number;
    total_touches: number;
    daily: string;
  };
  const rows: Row[] = Array.isArray(result)
    ? (result as unknown as Row[])
    : ((result as unknown as { rows: Row[] }).rows ?? []);

  const composed: StaffActivityRow[] = rows.map((r) => {
    const daily = parsePgIntArray(r.daily, windowDays);
    const activeDays = daily.filter((d) => d > 0).length;
    const avgPerActiveDay =
      activeDays > 0 ? Math.round((r.total_touches / activeDays) * 10) / 10 : 0;
    return {
      staffId: r.staff_id,
      displayName: r.display_name,
      primaryEmail: r.primary_email,
      role: r.role,
      calls: r.calls,
      emailsSent: r.emails_sent,
      smsSent: r.sms_sent,
      totalTouches: r.total_touches,
      daily,
      avgPerActiveDay,
    };
  });

  const totals: TeamAnalyticsTotals = {
    calls: composed.reduce((a, r) => a + r.calls, 0),
    emailsSent: composed.reduce((a, r) => a + r.emailsSent, 0),
    smsSent: composed.reduce((a, r) => a + r.smsSent, 0),
    totalTouches: composed.reduce((a, r) => a + r.totalTouches, 0),
    activeStaffCount: composed.filter((r) => r.totalTouches > 0).length,
  };

  const today = new Date();
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - (windowDays - 1));

  return {
    windowDays,
    windowStart: windowStart.toISOString().slice(0, 10),
    windowEnd: today.toISOString().slice(0, 10),
    rows: composed,
    totals,
  };
}

/**
 * Per-staff drill-down — daily breakdown over a window with the
 * actual log entries. Used by /admin/analytics/[staffId].
 */
export interface StaffDailyDetail {
  date: string;
  calls: number;
  emailsSent: number;
  smsSent: number;
  total: number;
}

export async function loadStaffDailyDetail(opts: {
  staffId: string;
  windowDays?: number;
}): Promise<StaffDailyDetail[]> {
  const windowDays = Math.min(Math.max(opts.windowDays ?? 30, 1), 365);

  const result = await db.execute<{
    day: string;
    calls: number;
    emails_sent: number;
    sms_sent: number;
  }>(sql`
    WITH date_series AS (
      SELECT generate_series(
        (CURRENT_DATE - (${windowDays - 1} || ' days')::interval)::date,
        CURRENT_DATE,
        '1 day'::interval
      )::date AS day
    )
    SELECT
      ds.day::text AS day,
      COUNT(ol.id) FILTER (WHERE ol.channel = 'call')::int AS calls,
      COUNT(ol.id) FILTER (
        WHERE ol.channel = 'email'
          AND ol.outcome IN ('sent','interested','confirmed','callback_requested')
      )::int AS emails_sent,
      COUNT(ol.id) FILTER (
        WHERE ol.channel = 'sms'
          AND ol.outcome IN ('sent','interested','confirmed','callback_requested')
      )::int AS sms_sent
    FROM date_series ds
    LEFT JOIN outreach_log ol
      ON ol.staff_member_id = ${opts.staffId}
      AND ol.created_at::date = ds.day
    GROUP BY ds.day
    ORDER BY ds.day ASC
  `);

  type Row = { day: string; calls: number; emails_sent: number; sms_sent: number };
  const rows: Row[] = Array.isArray(result)
    ? (result as unknown as Row[])
    : ((result as unknown as { rows: Row[] }).rows ?? []);

  return rows.map((r) => ({
    date: r.day,
    calls: r.calls,
    emailsSent: r.emails_sent,
    smsSent: r.sms_sent,
    total: r.calls + r.emails_sent + r.sms_sent,
  }));
}

/**
 * Parse a postgres int-array text representation like "{0,1,3,0}"
 * into a number[]. Falls back to zeros when the format is unexpected
 * so a malformed cell doesn't crash the page.
 */
function parsePgIntArray(raw: string | null | number[], expectedLength: number): number[] {
  if (Array.isArray(raw)) return raw;
  if (!raw) return new Array(expectedLength).fill(0);
  // pg returns either "{1,2,3}" or for empty rows possibly "{NULL,NULL,...}"
  const inner = raw.replace(/^\{|\}$/g, "");
  if (!inner) return new Array(expectedLength).fill(0);
  const parts = inner.split(",").map((s) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  });
  // Defensive — if length doesn't match window, pad/truncate
  if (parts.length < expectedLength) {
    return [...new Array(expectedLength - parts.length).fill(0), ...parts];
  }
  return parts.slice(-expectedLength);
}
