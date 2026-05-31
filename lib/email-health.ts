/**
 * Email Health Dashboard loader.
 *
 * Per-connected-account view of operational signal: status, cap
 * usage, recent send/reply/bounce counts, stale thread count, last
 * sync time, sync-error count. Surfaced on /admin/email-health so
 * leads can spot reauth-needed accounts, hot inboxes, and bounce-
 * rate cliffs at a glance.
 *
 * Time windows:
 *   today      sends/replies in the operator's local day
 *   7d         sends/replies in the last 7 days
 *   bouncesAll lifetime bounce count (small numbers in practice)
 *
 * Single round-trip per account: one wide SELECT with CTEs for the
 * derived counts. Acceptable up to ~50 connected accounts per
 * team (typical: 2-10).
 */

import {
  connectedAccounts,
  emailMessages,
  emailSendEvents,
  emailSoftBounces,
  emailThreads,
  staffMembers,
} from "@/db/schema";
import { db } from "@/lib/db";
import { startOfLocalDay } from "@/lib/send-cap";
import { eq, sql } from "drizzle-orm";

export type AccountHealthStatus = "healthy" | "needs_reauth" | "disconnected" | "stale";

export interface AccountHealthRow {
  id: string;
  emailAddress: string;
  ownerName: string | null;
  ownerUserId: string;
  status: AccountHealthStatus;
  /** Connection status from connected_accounts.status enum. */
  rawStatus: string;
  coldSendCap: number;
  coldSendsToday: number;
  sendsLast7d: number;
  inboundLast7d: number;
  staleThreads: number;
  unreadCount: number;
  lastSyncedAt: Date | null;
  lastInboundAt: Date | null;
}

export interface EmailHealthDashboard {
  accounts: AccountHealthRow[];
  teamTotals: {
    accountsConnected: number;
    accountsNeedingReauth: number;
    coldSendsToday: number;
    capTotalToday: number;
    unreadCount: number;
    staleThreads: number;
    bouncesLast30d: number;
  };
}

/**
 * Load every team account with operational health derived. Admin-
 * only surface — caller is responsible for gating on staff.role.
 */
export async function loadEmailHealthDashboard(teamId: string): Promise<EmailHealthDashboard> {
  const accounts = await db
    .select({
      id: connectedAccounts.id,
      emailAddress: connectedAccounts.emailAddress,
      ownerUserId: connectedAccounts.ownerUserId,
      ownerName: staffMembers.displayName,
      ownerTimezone: staffMembers.timezone,
      rawStatus: connectedAccounts.status,
      coldSendCap: connectedAccounts.dailyColdSendCap,
      lastSyncedAt: connectedAccounts.lastSyncedAt,
    })
    .from(connectedAccounts)
    .leftJoin(staffMembers, eq(staffMembers.id, connectedAccounts.ownerUserId))
    .where(eq(connectedAccounts.teamId, teamId))
    .orderBy(connectedAccounts.emailAddress);

  if (accounts.length === 0) {
    return {
      accounts: [],
      teamTotals: {
        accountsConnected: 0,
        accountsNeedingReauth: 0,
        coldSendsToday: 0,
        capTotalToday: 0,
        unreadCount: 0,
        staleThreads: 0,
        bouncesLast30d: 0,
      },
    };
  }

  // Compute per-account derived counts in parallel batches keyed by
  // account id. Each one is a small aggregate query. Keeping them
  // separate lets us reason about index usage independently.
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const staleThresholdMs = 4 * 60 * 60 * 1000; // 4h business approx

  const rows: AccountHealthRow[] = await Promise.all(
    accounts.map(async (a) => {
      const tz = a.ownerTimezone ?? "UTC";
      const todayStart = startOfLocalDay(tz);
      const [
        coldSendsTodayRow,
        sendsLast7dRow,
        inboundLast7dRow,
        staleThreadsRow,
        unreadRow,
        lastInboundRow,
      ] = await Promise.all([
        db.execute<{ n: number }>(sql`
          SELECT COUNT(*)::int AS n
          FROM ${emailSendEvents}
          WHERE connected_account_id = ${a.id}
            AND category = 'cold'
            AND counted_against_cap = true
            AND sent_at >= ${todayStart}
        `),
        db.execute<{ n: number }>(sql`
          SELECT COUNT(*)::int AS n
          FROM ${emailSendEvents}
          WHERE connected_account_id = ${a.id}
            AND sent_at >= ${sevenDaysAgo}
        `),
        db.execute<{ n: number }>(sql`
          SELECT COUNT(*)::int AS n
          FROM ${emailMessages} em
          INNER JOIN ${emailThreads} et ON et.id = em.thread_id
          WHERE et.staff_outreach_email_id = ${a.id}
            AND em.direction = 'inbound'
            AND em.sent_at >= ${sevenDaysAgo}
        `),
        db.execute<{ n: number }>(sql`
          SELECT COUNT(*)::int AS n
          FROM ${emailThreads}
          WHERE staff_outreach_email_id = ${a.id}
            AND state = 'needs_reply'
            AND last_inbound_at IS NOT NULL
            AND last_inbound_at < NOW() - INTERVAL '${sql.raw(`${staleThresholdMs / 1000} seconds`)}'
        `),
        db.execute<{ n: number }>(sql`
          SELECT COALESCE(SUM(unread_count), 0)::int AS n
          FROM ${emailThreads}
          WHERE staff_outreach_email_id = ${a.id}
            AND state NOT IN ('archived', 'trash')
        `),
        db.execute<{ t: Date | null }>(sql`
          SELECT MAX(last_inbound_at) AS t
          FROM ${emailThreads}
          WHERE staff_outreach_email_id = ${a.id}
        `),
      ]);
      const pick = <T>(r: unknown): T | null => {
        const list = Array.isArray(r) ? (r as Array<T>) : ((r as { rows: Array<T> }).rows ?? []);
        return list[0] ?? null;
      };
      const coldSendsToday = pick<{ n: number }>(coldSendsTodayRow)?.n ?? 0;
      const sendsLast7d = pick<{ n: number }>(sendsLast7dRow)?.n ?? 0;
      const inboundLast7d = pick<{ n: number }>(inboundLast7dRow)?.n ?? 0;
      const staleThreads = pick<{ n: number }>(staleThreadsRow)?.n ?? 0;
      const unreadCount = pick<{ n: number }>(unreadRow)?.n ?? 0;
      const lastInboundAt = pick<{ t: Date | null }>(lastInboundRow)?.t ?? null;

      // Health status derivation. raw status from connected_accounts
      // is the source of truth for connection; we layer "stale" on
      // top when the account hasn't synced in 6h+ even though it
      // claims to be connected.
      const status: AccountHealthStatus =
        a.rawStatus === "needs_reauth"
          ? "needs_reauth"
          : a.rawStatus === "disconnected"
            ? "disconnected"
            : a.lastSyncedAt && Date.now() - a.lastSyncedAt.getTime() > 6 * 60 * 60 * 1000
              ? "stale"
              : "healthy";

      return {
        id: a.id,
        emailAddress: a.emailAddress,
        ownerName: a.ownerName,
        ownerUserId: a.ownerUserId,
        status,
        rawStatus: a.rawStatus,
        coldSendCap: a.coldSendCap,
        coldSendsToday,
        sendsLast7d,
        inboundLast7d,
        staleThreads,
        unreadCount,
        lastSyncedAt: a.lastSyncedAt,
        lastInboundAt,
      };
    }),
  );

  // Team-totals roll-up. Add a team-wide bounces count (the table
  // is team-scoped, not per-account) so the dashboard surfaces
  // deliverability health at the team level.
  const teamBouncesRow = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM ${emailSoftBounces}
    WHERE team_id = ${teamId}
      AND last_seen_at >= ${thirtyDaysAgo}
  `);
  const pickN = (r: unknown): number => {
    const list = Array.isArray(r)
      ? (r as Array<{ n: number }>)
      : ((r as { rows: Array<{ n: number }> }).rows ?? []);
    return list[0]?.n ?? 0;
  };
  const bouncesLast30d = pickN(teamBouncesRow);

  const teamTotals = {
    accountsConnected: rows.filter((r) => r.status !== "disconnected").length,
    accountsNeedingReauth: rows.filter((r) => r.status === "needs_reauth").length,
    coldSendsToday: rows.reduce((s, r) => s + r.coldSendsToday, 0),
    capTotalToday: rows.reduce((s, r) => s + (r.status !== "disconnected" ? r.coldSendCap : 0), 0),
    unreadCount: rows.reduce((s, r) => s + r.unreadCount, 0),
    staleThreads: rows.reduce((s, r) => s + r.staleThreads, 0),
    bouncesLast30d,
  };

  return { accounts: rows, teamTotals };
}
