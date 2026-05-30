import "server-only";

/**
 * Daily per-inbox stats aggregator. Computes one row per
 * (connected_account, UTC day) with cold sends, replies, bounces,
 * and end-of-day stale-thread snapshot. Powers the inline
 * sparklines on /settings/inboxes and the alert-threshold rules.
 *
 * Idempotent — re-running for the same day upserts via the unique
 * (account, stat_date) constraint. Safe to invoke from cron at
 * end-of-day OR mid-day (it'll just overwrite with the latest
 * partial-day numbers).
 *
 * Convention:
 *   - "yesterday" = the UTC day strictly before now. The cron should
 *     run shortly after UTC midnight so each day's final snapshot
 *     lands.
 *   - All four metrics use the same {start, end} window — no metric
 *     gets a slightly different range. Consistency wins over
 *     hand-tuning each one.
 *
 * Not in scope:
 *   - Backfill of historical days. New inboxes get rows starting
 *     from their first aggregator tick. If we ever need backfill,
 *     it's a one-off script reading email_send_events + email_messages
 *     over the desired window.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface AggregateDailyStatsResult {
  statDate: string;
  rowsUpserted: number;
}

/**
 * Aggregate stats for a given UTC date. Defaults to "yesterday"
 * (the most recent fully-completed UTC day) when no date passed.
 *
 * Returns the date that was aggregated + the row count for telemetry.
 */
export async function runDailyInboxStats(
  opts: { date?: Date } = {},
): Promise<AggregateDailyStatsResult> {
  // Resolve the target UTC day. JS Date is local-time biased; we
  // compute the YYYY-MM-DD string explicitly to avoid any TZ drift.
  const target =
    opts.date ??
    (() => {
      const d = new Date();
      // step back into yesterday UTC
      d.setUTCDate(d.getUTCDate() - 1);
      return d;
    })();
  const statDate = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(target.getUTCDate()).padStart(2, "0")}`;

  // One ANY()-friendly upsert that joins the four sources into a
  // single per-account row. We compute on every connected_account
  // (not just the ones with activity) so the sparkline shows
  // zero-bars for quiet days — operators want to SEE that an inbox
  // didn't send anything, not have its history vanish.
  const result = await db.execute<{ n: number }>(sql`
    WITH cold AS (
      SELECT connected_account_id, COUNT(*)::int AS n
      FROM email_send_events
      WHERE counted_against_cap = true
        AND sent_at >= ${statDate}::date
        AND sent_at < (${statDate}::date + interval '1 day')
      GROUP BY connected_account_id
    ),
    reply AS (
      SELECT et.staff_outreach_email_id AS connected_account_id, COUNT(*)::int AS n
      FROM email_messages em
      JOIN email_threads et ON et.id = em.thread_id
      WHERE em.direction = 'inbound'
        AND em.sent_at >= ${statDate}::date
        AND em.sent_at < (${statDate}::date + interval '1 day')
      GROUP BY et.staff_outreach_email_id
    ),
    bounce AS (
      SELECT ese.connected_account_id, COUNT(DISTINCT ese.recipient_email)::int AS n
      FROM email_send_events ese
      JOIN email_suppression es
        ON lower(es.email) = lower(ese.recipient_email)
       AND es.reason = 'bounced'
       AND es.created_at >= ${statDate}::date
       AND es.created_at < (${statDate}::date + interval '1 day')
      GROUP BY ese.connected_account_id
    ),
    stale AS (
      SELECT staff_outreach_email_id AS connected_account_id, COUNT(*)::int AS n
      FROM email_threads
      WHERE is_stale = true
        AND state IN ('needs_reply', 'waiting_on_them', 'follow_up_due')
      GROUP BY staff_outreach_email_id
    )
    INSERT INTO inbox_daily_stats
      (connected_account_id, stat_date, cold_sends, replies, bounces, stale_threads_at_eod, computed_at)
    SELECT
      ca.id,
      ${statDate}::date,
      COALESCE(cold.n, 0),
      COALESCE(reply.n, 0),
      COALESCE(bounce.n, 0),
      COALESCE(stale.n, 0),
      now()
    FROM connected_accounts ca
    LEFT JOIN cold   ON cold.connected_account_id   = ca.id
    LEFT JOIN reply  ON reply.connected_account_id  = ca.id
    LEFT JOIN bounce ON bounce.connected_account_id = ca.id
    LEFT JOIN stale  ON stale.connected_account_id  = ca.id
    ON CONFLICT (connected_account_id, stat_date) DO UPDATE
      SET cold_sends           = EXCLUDED.cold_sends,
          replies              = EXCLUDED.replies,
          bounces              = EXCLUDED.bounces,
          stale_threads_at_eod = EXCLUDED.stale_threads_at_eod,
          computed_at          = now()
    RETURNING 1 AS n
  `);

  const rows = Array.isArray(result)
    ? (result as Array<{ n: number }>)
    : ((result as unknown as { rows: Array<{ n: number }> }).rows ?? []);

  return { statDate, rowsUpserted: rows.length };
}

/**
 * Reads back the last N days of stats for a set of accounts.
 * Returns a Map keyed by account id whose value is an array of
 * { date, cold_sends, replies, bounces } ordered ascending so the
 * sparkline can render left-to-right oldest-to-newest.
 */
export interface DailyStatPoint {
  date: string;
  coldSends: number;
  replies: number;
  bounces: number;
  staleThreadsAtEod: number;
}

export async function loadInboxDailyStats(
  accountIds: string[],
  opts: { days?: number } = {},
): Promise<Map<string, DailyStatPoint[]>> {
  const out = new Map<string, DailyStatPoint[]>();
  if (accountIds.length === 0) return out;
  const days = opts.days ?? 14;

  const result = await db.execute<{
    account: string;
    d: string;
    cold_sends: number;
    replies: number;
    bounces: number;
    stale: number;
  }>(sql`
    SELECT
      connected_account_id::text AS account,
      stat_date::text             AS d,
      cold_sends,
      replies,
      bounces,
      stale_threads_at_eod        AS stale
    FROM inbox_daily_stats
    WHERE connected_account_id = ANY (${accountIds}::uuid[])
      AND stat_date >= (CURRENT_DATE - ${days}::int)
    ORDER BY connected_account_id, stat_date ASC
  `);

  const rows = Array.isArray(result)
    ? (result as Array<{
        account: string;
        d: string;
        cold_sends: number;
        replies: number;
        bounces: number;
        stale: number;
      }>)
    : ((
        result as unknown as {
          rows: Array<{
            account: string;
            d: string;
            cold_sends: number;
            replies: number;
            bounces: number;
            stale: number;
          }>;
        }
      ).rows ?? []);

  for (const r of rows) {
    const arr = out.get(r.account) ?? [];
    arr.push({
      date: r.d,
      coldSends: r.cold_sends,
      replies: r.replies,
      bounces: r.bounces,
      staleThreadsAtEod: r.stale,
    });
    out.set(r.account, arr);
  }
  return out;
}
