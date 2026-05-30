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
  viberTouches: number;
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
  viberTouches: number;
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
    /** ISO date string YYYY-MM-DD. When BOTH from + to are provided
     *  they override windowDays — used by the explicit date-range
     *  picker. Inclusive on both ends. */
    from?: string;
    to?: string;
  } = {},
): Promise<TeamAnalytics> {
  // Compute the effective window. If explicit from + to provided
  // we honor them (clamped to a 365-day max so the SQL doesn't
  // blow up on accidental year-long ranges); otherwise we use
  // the windowDays preset.
  const useExplicitRange = Boolean(
    opts.from && opts.to && isValidIsoDate(opts.from) && isValidIsoDate(opts.to),
  );
  let windowDays: number;
  let fromIso: string;
  let toIso: string;
  if (useExplicitRange) {
    fromIso = opts.from as string;
    toIso = opts.to as string;
    // Re-derive windowDays for the per-row sparkline (each entry's
    // daily[] is sized to windowDays).
    const fromTs = Date.parse(fromIso);
    const toTs = Date.parse(toIso);
    const rawDays = Math.floor((toTs - fromTs) / 86_400_000) + 1;
    windowDays = Math.min(Math.max(rawDays, 1), 365);
  } else {
    windowDays = Math.min(Math.max(opts.windowDays ?? 7, 1), 90);
    fromIso = "";
    toIso = "";
  }

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
    viber_touches: number;
    total_touches: number;
    daily: string; // postgres returns int[] as a string like "{0,1,3,0,5,2,1}"
  }>(sql`
    WITH date_series AS (
      SELECT generate_series(
        ${useExplicitRange ? sql`${fromIso}::date` : sql`(CURRENT_DATE - (${windowDays - 1} || ' days')::interval)::date`},
        ${useExplicitRange ? sql`${toIso}::date` : sql`CURRENT_DATE`},
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
      WHERE ol.created_at >= ${useExplicitRange ? sql`${fromIso}::date` : sql`CURRENT_DATE - (${windowDays - 1} || ' days')::interval`}
        ${useExplicitRange ? sql`AND ol.created_at < ${toIso}::date + '1 day'::interval` : sql``}
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
        )::int AS day_sms,
        COUNT(liw.staff_member_id) FILTER (
          WHERE liw.channel = 'viber'
        )::int AS day_viber
      FROM users sm
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
      COALESCE(SUM(psd.day_viber), 0)::int AS viber_touches,
      COALESCE(SUM(psd.day_calls + psd.day_emails + psd.day_sms + psd.day_viber), 0)::int AS total_touches,
      ARRAY_AGG(
        (psd.day_calls + psd.day_emails + psd.day_sms + psd.day_viber)
        ORDER BY psd.day ASC
      )::text AS daily
    FROM users sm
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
    viber_touches: number;
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
      viberTouches: r.viber_touches,
      totalTouches: r.total_touches,
      daily,
      avgPerActiveDay,
    };
  });

  const totals: TeamAnalyticsTotals = {
    calls: composed.reduce((a, r) => a + r.calls, 0),
    emailsSent: composed.reduce((a, r) => a + r.emailsSent, 0),
    smsSent: composed.reduce((a, r) => a + r.smsSent, 0),
    viberTouches: composed.reduce((a, r) => a + r.viberTouches, 0),
    totalTouches: composed.reduce((a, r) => a + r.totalTouches, 0),
    activeStaffCount: composed.filter((r) => r.totalTouches > 0).length,
  };

  const today = new Date();
  const windowStartIso = useExplicitRange
    ? fromIso
    : (() => {
        const d = new Date(today);
        d.setDate(d.getDate() - (windowDays - 1));
        return d.toISOString().slice(0, 10);
      })();
  const windowEndIso = useExplicitRange ? toIso : today.toISOString().slice(0, 10);

  return {
    windowDays,
    windowStart: windowStartIso,
    windowEnd: windowEndIso,
    rows: composed,
    totals,
  };
}

function isValidIsoDate(s: string): boolean {
  // Strict YYYY-MM-DD plus a sanity-check via Date.parse so something
  // like "2025-13-99" doesn't slip through.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ts = Date.parse(s);
  return Number.isFinite(ts);
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
  viberTouches: number;
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
    viber_touches: number;
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
      )::int AS sms_sent,
      COUNT(ol.id) FILTER (WHERE ol.channel = 'viber')::int AS viber_touches
    FROM date_series ds
    LEFT JOIN outreach_log ol
      ON ol.staff_member_id = ${opts.staffId}
      AND ol.created_at::date = ds.day
    GROUP BY ds.day
    ORDER BY ds.day ASC
  `);

  type Row = {
    day: string;
    calls: number;
    emails_sent: number;
    sms_sent: number;
    viber_touches: number;
  };
  const rows: Row[] = Array.isArray(result)
    ? (result as unknown as Row[])
    : ((result as unknown as { rows: Row[] }).rows ?? []);

  return rows.map((r) => ({
    date: r.day,
    calls: r.calls,
    emailsSent: r.emails_sent,
    smsSent: r.sms_sent,
    viberTouches: r.viber_touches,
    total: r.calls + r.emails_sent + r.sms_sent + r.viber_touches,
  }));
}

/**
 * Parse a postgres int-array text representation like "{0,1,3,0}"
 * into a number[]. Falls back to zeros when the format is unexpected
 * so a malformed cell doesn't crash the page.
 */
/**
 * Per-staff profile loader — full activity picture for one operator.
 *
 * Loads:
 *   • Staff member metadata (name, email, role, status)
 *   • Daily breakdown over the window (drives the bar chart)
 *   • Top venues by touch count over the window (drives the table)
 *   • Recent activity feed (last 30 outreach_log entries with venue
 *     name + outcome + channel for a chronological view)
 *
 * Admin-only — caller MUST gate with requireAdmin().
 */

export interface StaffProfile {
  staffId: string;
  displayName: string;
  primaryEmail: string;
  role: string;
  status: string;
}

export interface TopVenueRow {
  venueId: string;
  venueName: string;
  cityName: string | null;
  totalTouches: number;
  calls: number;
  emails: number;
  sms: number;
  viber: number;
  lastTouchAt: string;
}

export interface ActivityFeedRow {
  logId: string;
  venueId: string;
  venueName: string;
  cityName: string | null;
  channel: string;
  outcome: string;
  notes: string | null;
  createdAt: string;
}

export interface StaffActivityProfile {
  staff: StaffProfile;
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  daily: StaffDailyDetail[];
  totals: {
    calls: number;
    emailsSent: number;
    smsSent: number;
    viberTouches: number;
    totalTouches: number;
    activeDays: number;
  };
  topVenues: TopVenueRow[];
  recentActivity: ActivityFeedRow[];
}

export async function loadStaffActivityProfile(opts: {
  staffId: string;
  windowDays?: number;
}): Promise<StaffActivityProfile | null> {
  const windowDays = Math.min(Math.max(opts.windowDays ?? 30, 1), 365);

  // Staff metadata
  const staffResult = await db.execute<{
    id: string;
    display_name: string;
    primary_email: string;
    role: string;
    status: string;
  }>(sql`
    SELECT id, display_name, primary_email, role::text AS role, status::text AS status
    FROM users
    WHERE id = ${opts.staffId}
    LIMIT 1
  `);
  type StaffRow = {
    id: string;
    display_name: string;
    primary_email: string;
    role: string;
    status: string;
  };
  const staffRows: StaffRow[] = Array.isArray(staffResult)
    ? (staffResult as unknown as StaffRow[])
    : ((staffResult as unknown as { rows: StaffRow[] }).rows ?? []);
  const staffRow = staffRows[0];
  if (!staffRow) return null;

  // Parallel: daily, top venues, recent feed
  const [daily, topVenues, recentActivity] = await Promise.all([
    loadStaffDailyDetail({ staffId: opts.staffId, windowDays }),
    loadTopVenuesForStaff(opts.staffId, windowDays),
    loadRecentActivityForStaff(opts.staffId, 30),
  ]);

  const totals = {
    calls: daily.reduce((a, d) => a + d.calls, 0),
    emailsSent: daily.reduce((a, d) => a + d.emailsSent, 0),
    smsSent: daily.reduce((a, d) => a + d.smsSent, 0),
    viberTouches: daily.reduce((a, d) => a + d.viberTouches, 0),
    totalTouches: daily.reduce((a, d) => a + d.total, 0),
    activeDays: daily.filter((d) => d.total > 0).length,
  };

  const today = new Date();
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - (windowDays - 1));

  return {
    staff: {
      staffId: staffRow.id,
      displayName: staffRow.display_name,
      primaryEmail: staffRow.primary_email,
      role: staffRow.role,
      status: staffRow.status,
    },
    windowDays,
    windowStart: windowStart.toISOString().slice(0, 10),
    windowEnd: today.toISOString().slice(0, 10),
    daily,
    totals,
    topVenues,
    recentActivity,
  };
}

async function loadTopVenuesForStaff(staffId: string, windowDays: number): Promise<TopVenueRow[]> {
  const result = await db.execute<{
    venue_id: string;
    venue_name: string;
    city_name: string | null;
    total_touches: number;
    calls: number;
    emails: number;
    sms: number;
    viber: number;
    last_touch_at: string;
  }>(sql`
    SELECT
      v.id AS venue_id,
      v.name AS venue_name,
      c.name AS city_name,
      COUNT(ol.id)::int AS total_touches,
      COUNT(ol.id) FILTER (WHERE ol.channel = 'call')::int AS calls,
      COUNT(ol.id) FILTER (
        WHERE ol.channel = 'email'
          AND ol.outcome IN ('sent','interested','confirmed','callback_requested')
      )::int AS emails,
      COUNT(ol.id) FILTER (
        WHERE ol.channel = 'sms'
          AND ol.outcome IN ('sent','interested','confirmed','callback_requested')
      )::int AS sms,
      COUNT(ol.id) FILTER (WHERE ol.channel = 'viber')::int AS viber,
      MAX(ol.created_at)::text AS last_touch_at
    FROM outreach_log ol
    JOIN venues v ON v.id = ol.venue_id
    LEFT JOIN cities c ON c.id = v.city_id
    WHERE ol.staff_member_id = ${staffId}
      AND ol.created_at >= CURRENT_DATE - (${windowDays - 1} || ' days')::interval
    GROUP BY v.id, v.name, c.name
    ORDER BY total_touches DESC, MAX(ol.created_at) DESC
    LIMIT 10
  `);

  type Row = {
    venue_id: string;
    venue_name: string;
    city_name: string | null;
    total_touches: number;
    calls: number;
    emails: number;
    sms: number;
    viber: number;
    last_touch_at: string;
  };
  const rows: Row[] = Array.isArray(result)
    ? (result as unknown as Row[])
    : ((result as unknown as { rows: Row[] }).rows ?? []);

  return rows.map((r) => ({
    venueId: r.venue_id,
    venueName: r.venue_name,
    cityName: r.city_name,
    totalTouches: r.total_touches,
    calls: r.calls,
    emails: r.emails,
    sms: r.sms,
    viber: r.viber,
    lastTouchAt: r.last_touch_at,
  }));
}

async function loadRecentActivityForStaff(
  staffId: string,
  limit: number,
): Promise<ActivityFeedRow[]> {
  const result = await db.execute<{
    log_id: string;
    venue_id: string;
    venue_name: string;
    city_name: string | null;
    channel: string;
    outcome: string;
    notes: string | null;
    created_at: string;
  }>(sql`
    SELECT
      ol.id AS log_id,
      v.id AS venue_id,
      v.name AS venue_name,
      c.name AS city_name,
      ol.channel::text AS channel,
      ol.outcome::text AS outcome,
      ol.notes,
      ol.created_at::text AS created_at
    FROM outreach_log ol
    JOIN venues v ON v.id = ol.venue_id
    LEFT JOIN cities c ON c.id = v.city_id
    WHERE ol.staff_member_id = ${staffId}
    ORDER BY ol.created_at DESC
    LIMIT ${limit}
  `);

  type Row = {
    log_id: string;
    venue_id: string;
    venue_name: string;
    city_name: string | null;
    channel: string;
    outcome: string;
    notes: string | null;
    created_at: string;
  };
  const rows: Row[] = Array.isArray(result)
    ? (result as unknown as Row[])
    : ((result as unknown as { rows: Row[] }).rows ?? []);

  return rows.map((r) => ({
    logId: r.log_id,
    venueId: r.venue_id,
    venueName: r.venue_name,
    cityName: r.city_name,
    channel: r.channel,
    outcome: r.outcome,
    notes: r.notes,
    createdAt: r.created_at,
  }));
}

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
