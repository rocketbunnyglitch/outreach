import "server-only";

/**
 * Loader for the Gmail-style top-right account switcher on /inbox.
 *
 * Returns every connected Gmail account the operator can see, with
 * health + cold-send usage + per-account unread count attached.
 *
 * Visibility rules:
 *   - Always: the operator's own connected accounts (ownerUserId = me)
 *   - For admins / leads: every account on the same team
 *   - For staff: their own accounts + any account marked as team-
 *     accessible (future: an explicit shareWith list; for now we
 *     surface the whole team for everyone, gated by send permission
 *     elsewhere)
 *
 * The "send permission" gate lives at composeAndSend time —
 * visibility is intentionally broader than send-from authority so
 * staff can collaborate on a campaign by seeing each others' threads
 * without being able to send from another operator's inbox.
 */

import { connectedAccounts, emailThreads, users } from "@/db/schema";
import { db } from "@/lib/db";
import { startOfLocalDay } from "@/lib/send-cap";
import { and, eq, isNull, sql } from "drizzle-orm";

export type AccountHealth = "healthy" | "needs_reauth" | "error" | "disconnected";

export interface VisibleAccount {
  id: string;
  emailAddress: string;
  ownerUserId: string;
  ownerName: string | null;
  /** True when the current operator is the owner. The composer's
   *  Send From gate ultimately enforces this; we surface it here so
   *  the UI can show a "Draft for owner" hint on others' accounts. */
  isMine: boolean;
  health: AccountHealth;
  /** Cold sends used today (operator's tz). null when the cap
   *  loader didn't return a number — render as "—" in the UI. */
  coldSendsUsed: number;
  coldSendCap: number;
  /** Sum of unreadCount across non-archived/non-deleted threads on
   *  this account. Surfaced as a pill in the dropdown so operators
   *  can spot inboxes with traffic at a glance. */
  unreadCount: number;
}

interface Opts {
  currentUserId: string;
  currentTeamId: string;
  /** Admin / lead see every team account. Staff see only their own
   *  accounts in the dropdown by default. */
  canSeeAllTeamAccounts: boolean;
}

export async function loadVisibleAccounts(opts: Opts): Promise<VisibleAccount[]> {
  // Base set: every account on the team. We filter at the application
  // layer afterward based on canSeeAllTeamAccounts — simpler than a
  // dynamic WHERE branch and lets us still compute team-wide totals
  // if a future enhancement wants to show "X accounts on your team".
  const rows = await db
    .select({
      id: connectedAccounts.id,
      emailAddress: connectedAccounts.emailAddress,
      ownerUserId: connectedAccounts.ownerUserId,
      ownerName: users.displayName,
      status: connectedAccounts.status,
      cap: connectedAccounts.dailyColdSendCap,
    })
    .from(connectedAccounts)
    .leftJoin(users, eq(users.id, connectedAccounts.ownerUserId))
    .where(eq(connectedAccounts.teamId, opts.currentTeamId));

  // Per-account unread totals — one query, GROUP BY account, joined
  // back into the result. Skip archived + deleted threads since
  // they shouldn't influence the operator's "new mail" decision.
  const unreadByAccount = new Map<string, number>();
  if (rows.length > 0) {
    const counts = await db
      .select({
        accountId: emailThreads.staffOutreachEmailId,
        unread: sql<number>`SUM(${emailThreads.unreadCount})::int`,
      })
      .from(emailThreads)
      .where(
        and(
          isNull(emailThreads.deletedAt),
          // Don't surface unread from archived; matches the inbox view.
          sql`${emailThreads.state} <> 'archived'`,
        ),
      )
      .groupBy(emailThreads.staffOutreachEmailId);
    for (const c of counts) {
      if (c.accountId) unreadByAccount.set(c.accountId, Number(c.unread ?? 0));
    }
  }

  // Per-account cold-sends-used today. Done inline rather than
  // calling loadSendUsage in a loop to avoid N+1 — the inbox screen
  // can render dozens of rows.
  const usageByAccount = new Map<string, number>();
  if (rows.length > 0) {
    // Operator's tz drives "today" — for the dropdown view we use
    // the current user's tz as the universal anchor (matches what
    // the operator sees as "today" everywhere else in the app).
    const me = await db
      .select({ tz: users.timezone })
      .from(users)
      .where(eq(users.id, opts.currentUserId))
      .limit(1);
    const startOfDay = startOfLocalDay(me[0]?.tz ?? null);
    const usage = await db.execute<{ account_id: string; used: number }>(sql`
      SELECT
        connected_account_id AS account_id,
        COUNT(*) FILTER (WHERE category = 'cold' AND counted_against_cap = true)::int AS used
      FROM email_send_events
      WHERE sent_at >= ${startOfDay}
      GROUP BY connected_account_id
    `);
    const list = Array.isArray(usage)
      ? (usage as unknown as Array<{ account_id: string; used: number }>)
      : ((usage as unknown as { rows: Array<{ account_id: string; used: number }> }).rows ?? []);
    for (const r of list) {
      usageByAccount.set(r.account_id, Number(r.used ?? 0));
    }
  }

  // Filter to operator's-own when canSeeAllTeamAccounts is false.
  const filtered = opts.canSeeAllTeamAccounts
    ? rows
    : rows.filter((r) => r.ownerUserId === opts.currentUserId);

  // Map to the public shape, deriving health from the connected_
  // accounts.status enum.
  return filtered.map((r) => {
    const health: AccountHealth = ((): AccountHealth => {
      switch (r.status) {
        case "connected":
          return "healthy";
        case "needs_reauth":
          return "needs_reauth";
        default:
          return "disconnected";
      }
    })();
    return {
      id: r.id,
      emailAddress: r.emailAddress,
      ownerUserId: r.ownerUserId,
      ownerName: r.ownerName,
      isMine: r.ownerUserId === opts.currentUserId,
      health,
      coldSendsUsed: usageByAccount.get(r.id) ?? 0,
      coldSendCap: r.cap ?? 30,
      unreadCount: unreadByAccount.get(r.id) ?? 0,
    };
  });
}
