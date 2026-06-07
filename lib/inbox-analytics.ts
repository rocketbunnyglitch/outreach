/**
 * Per-account send analytics — rolling-window deliverability rollups
 * for the connected inboxes the operator can see.
 *
 * Computes, per inbox (over a 30-day rolling window unless otherwise
 * specified):
 *   - cold sends sent
 *   - replies received  (inbound on any thread whose latest outbound
 *                        came from this inbox in the same window)
 *   - bounces           (suppression rows with reason='bounced' for
 *                        recipients this inbox sent to in the window)
 *   - stale_threads     (currently-open threads owned by this inbox
 *                        flagged is_stale=true)
 *   - reply_rate        replies / cold_sends, 0 when cold_sends=0
 *   - bounce_rate       bounces / cold_sends, 0 when cold_sends=0
 *
 * Health is derived in the UI (a healthy account has: status=connected,
 * lastSyncedAt within 30 minutes, bounce_rate < 5%).
 *
 * Performance:
 *   The dashboard / settings page typically shows ≤10 inboxes for a
 *   single team. We load them with a single batched query keyed by
 *   the inbox id list. The most expensive piece — counting bounces —
 *   is bounded by the email_suppression table size (per-team list
 *   of dead addresses, typically dozens to low hundreds), not the
 *   email_messages table.
 *
 * Why 30 days:
 *   Long enough to smooth out daily variance (a single bad sending
 *   day shouldn't flip the health indicator), short enough to react
 *   if an inbox starts having deliverability issues. Operator can
 *   raise this with a param if they want lifetime stats.
 */

import "server-only";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface InboxAnalytics {
  /** Cold sends in the window. */
  coldSends: number;
  /** Inbound replies received in the window on threads sent from this inbox. */
  replies: number;
  /** Distinct recipient addresses this inbox sent to in the window
   *  that are now in email_suppression with reason='bounced'. */
  bounces: number;
  /** Currently-open threads owned by this inbox that are stale. */
  staleThreads: number;
  /** replies / coldSends, 0..1. Zero when coldSends is zero. */
  replyRate: number;
  /** bounces / coldSends, 0..1. Zero when coldSends is zero. */
  bounceRate: number;
}

const DEFAULT_WINDOW_DAYS = 30;

/**
 * Load analytics for a set of connected accounts. Returns a Map
 * keyed by account id. Accounts with no activity in the window
 * still appear in the result with zero counts (caller can rely on
 * the key existing).
 */
export async function loadInboxAnalytics(
  accountIds: string[],
  opts: { windowDays?: number } = {},
): Promise<Map<string, InboxAnalytics>> {
  const out = new Map<string, InboxAnalytics>();
  if (accountIds.length === 0) return out;

  // Initialise with zeros so the caller can always read a value.
  for (const id of accountIds) {
    out.set(id, {
      coldSends: 0,
      replies: 0,
      bounces: 0,
      staleThreads: 0,
      replyRate: 0,
      bounceRate: 0,
    });
  }

  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  // SQL parameter: any positive integer; matches what the cron
  // routes pass for window bounds elsewhere in the codebase.

  // -----------------------------------------------------------------
  // 1) Cold sends per inbox.
  //
  // counted_against_cap=true == cold (per the convention in
  // recordSendEvent — see lib/send-cap.ts). Warm sends and
  // bypassed-but-not-counted sends are excluded.
  // -----------------------------------------------------------------
  // Bind the account ids as a real uuid[] via ARRAY[...]. Interpolating the JS
  // array directly (accountIds::uuid[]) makes drizzle emit a RECORD cast ->
  // Postgres 22P02 "cannot cast type record to uuid[]" (same class as the bug
  // fixed in lib/inbox-daily-stats.ts + lib/venue-communication.ts).
  const accIds = sql`ARRAY[${sql.join(
    accountIds.map((x) => sql`${x}`),
    sql`, `,
  )}]::uuid[]`;
  const coldRows = await db.execute<{ account: string; n: number }>(sql`
    SELECT
      connected_account_id::text AS account,
      COUNT(*)::int               AS n
    FROM email_send_events
    WHERE connected_account_id = ANY (${accIds})
      AND counted_against_cap = true
      AND sent_at >= NOW() - (${windowDays} || ' days')::interval
    GROUP BY connected_account_id
  `);
  for (const r of normaliseRows<{ account: string; n: number }>(coldRows)) {
    const cur = out.get(r.account);
    if (cur) cur.coldSends = r.n;
  }

  // -----------------------------------------------------------------
  // 2) Replies per inbox.
  //
  // An inbound message on any thread whose staff_outreach_email_id
  // is one of our accounts AND whose sent_at is in the window.
  // We count message events, not thread events — a thread with
  // three back-and-forth replies counts as three.
  // -----------------------------------------------------------------
  const replyRows = await db.execute<{ account: string; n: number }>(sql`
    SELECT
      et.staff_outreach_email_id::text AS account,
      COUNT(*)::int                     AS n
    FROM email_messages em
    JOIN email_threads et ON et.id = em.thread_id
    WHERE et.staff_outreach_email_id = ANY (${accIds})
      AND em.direction = 'inbound'
      AND em.sent_at >= NOW() - (${windowDays} || ' days')::interval
    GROUP BY et.staff_outreach_email_id
  `);
  for (const r of normaliseRows<{ account: string; n: number }>(replyRows)) {
    const cur = out.get(r.account);
    if (cur) cur.replies = r.n;
  }

  // -----------------------------------------------------------------
  // 3) Bounces per inbox.
  //
  // Bounces aren't attributed to a specific inbox in email_suppression
  // (the table is per-team). We attribute by recipient match: a
  // suppression with reason='bounced' counts against an inbox if
  // that inbox sent to the address in the window.
  //
  // Edge case: the same address could have been emailed by multiple
  // inboxes on the team. We count the bounce against EACH inbox that
  // sent to it. This is intentional — every inbox that hit the dead
  // address contributed to the deliverability hit.
  // -----------------------------------------------------------------
  const bounceRows = await db.execute<{ account: string; n: number }>(sql`
    SELECT
      ese.connected_account_id::text AS account,
      COUNT(DISTINCT ese.recipient_email)::int AS n
    FROM email_send_events ese
    JOIN email_suppression es
      ON lower(es.email) = lower(ese.recipient_email)
     AND es.reason = 'bounced'
    WHERE ese.connected_account_id = ANY (${accIds})
      AND ese.sent_at >= NOW() - (${windowDays} || ' days')::interval
    GROUP BY ese.connected_account_id
  `);
  for (const r of normaliseRows<{ account: string; n: number }>(bounceRows)) {
    const cur = out.get(r.account);
    if (cur) cur.bounces = r.n;
  }

  // -----------------------------------------------------------------
  // 4) Stale threads per inbox (open + is_stale=true).
  // -----------------------------------------------------------------
  const staleRows = await db.execute<{ account: string; n: number }>(sql`
    SELECT
      staff_outreach_email_id::text AS account,
      COUNT(*)::int                  AS n
    FROM email_threads
    WHERE staff_outreach_email_id = ANY (${accIds})
      AND is_stale = true
      AND state IN ('needs_reply', 'waiting_on_them', 'follow_up_due')
    GROUP BY staff_outreach_email_id
  `);
  for (const r of normaliseRows<{ account: string; n: number }>(staleRows)) {
    const cur = out.get(r.account);
    if (cur) cur.staleThreads = r.n;
  }

  // Compute rates.
  for (const a of out.values()) {
    a.replyRate = a.coldSends > 0 ? a.replies / a.coldSends : 0;
    a.bounceRate = a.coldSends > 0 ? a.bounces / a.coldSends : 0;
  }
  return out;
}

/** db.execute returns either an array or { rows }. Normalise. */
function normaliseRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown[] }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

/**
 * Health classification — derived from the analytics + connection
 * status. Returned by the UI helper, not stored.
 *
 * Tiers:
 *   healthy   — status=connected, recent sync, bounceRate < 5%
 *   warming   — status=connected, coldSends < 10 in window (not
 *               enough signal to assess; treat as okay)
 *   needs_attention — bounceRate >= 5% OR no recent sync
 *   disconnected — status != connected
 */
export type HealthTier = "healthy" | "warming" | "needs_attention" | "disconnected";

export function classifyHealth(opts: {
  status: string;
  lastSyncedAt: Date | null;
  analytics: InboxAnalytics;
}): HealthTier {
  if (opts.status !== "connected") return "disconnected";
  const lastSyncMs = opts.lastSyncedAt ? opts.lastSyncedAt.getTime() : 0;
  const ageMs = Date.now() - lastSyncMs;
  const SYNC_STALE_MS = 30 * 60 * 1000; // 30 minutes
  if (!opts.lastSyncedAt || ageMs > SYNC_STALE_MS) return "needs_attention";
  if (opts.analytics.bounceRate >= 0.05) return "needs_attention";
  if (opts.analytics.coldSends < 10) return "warming";
  return "healthy";
}
