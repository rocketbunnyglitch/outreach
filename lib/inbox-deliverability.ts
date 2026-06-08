import "server-only";

import { connectedAccounts, emailSendEvents, emailSuppression, emailThreads } from "@/db/schema";
import { db } from "@/lib/db";
import { warmupStatus } from "@/lib/inbox-warmup";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

/**
 * Per-inbox deliverability monitoring: send volume + bounce/complaint rates +
 * warm-up status. A burning inbox (high bounce or complaint rate) can torch the
 * whole sending domain, so we surface this and can auto-pause cold sends from
 * it (connected_accounts.cold_sends_paused, enforced in send-cap preflight).
 *
 * Bounce/complaint attribution: email_suppression rows (reason bounced /
 * complained) carry a source_thread_id; the thread carries the sending inbox,
 * so we attribute each to the inbox that sent the offending message.
 */

// Industry deliverability danger lines. Google starts throttling well before a
// 5% bounce rate; 0.1% spam complaints is the Postmaster red line.
export const BOUNCE_RATE_LIMIT = 0.05;
export const COMPLAINT_RATE_LIMIT = 0.001;
// Don't flag/auto-pause until there's enough volume for the rate to mean
// anything (one bounce out of three sends isn't a 33% problem).
const MIN_VOLUME_FOR_RISK = 10;

export interface InboxDeliverability {
  id: string;
  email: string;
  status: string;
  paused: boolean;
  configuredCap: number;
  effectiveCap: number;
  warming: boolean;
  warmupDaysIn: number;
  sent: number;
  bounced: number;
  complained: number;
  bounceRate: number;
  complaintRate: number;
  atRisk: boolean;
}

export async function loadInboxDeliverability(
  teamId: string,
  windowDays = 7,
): Promise<InboxDeliverability[]> {
  const now = new Date();
  const since = new Date(now.getTime() - windowDays * 86_400_000);

  const accts = await db
    .select({
      id: connectedAccounts.id,
      email: connectedAccounts.emailAddress,
      status: connectedAccounts.status,
      cap: connectedAccounts.dailyColdSendCap,
      warmupStartedAt: connectedAccounts.warmupStartedAt,
      paused: connectedAccounts.coldSendsPaused,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.teamId, teamId));

  const sentRows = await db
    .select({ accId: emailSendEvents.connectedAccountId, n: sql<number>`count(*)::int` })
    .from(emailSendEvents)
    .where(and(eq(emailSendEvents.teamId, teamId), gte(emailSendEvents.sentAt, since)))
    .groupBy(emailSendEvents.connectedAccountId);
  const sentMap = new Map(sentRows.map((r) => [r.accId, Number(r.n)]));

  const suppRows = await db
    .select({
      accId: emailThreads.staffOutreachEmailId,
      reason: emailSuppression.reason,
      n: sql<number>`count(*)::int`,
    })
    .from(emailSuppression)
    .innerJoin(emailThreads, eq(emailThreads.id, emailSuppression.sourceThreadId))
    .where(
      and(
        eq(emailSuppression.teamId, teamId),
        gte(emailSuppression.createdAt, since),
        inArray(emailSuppression.reason, ["bounced", "complained"]),
      ),
    )
    .groupBy(emailThreads.staffOutreachEmailId, emailSuppression.reason);
  const bouncedMap = new Map<string, number>();
  const complainedMap = new Map<string, number>();
  for (const r of suppRows) {
    if (!r.accId) continue;
    if (r.reason === "bounced") bouncedMap.set(r.accId, Number(r.n));
    else if (r.reason === "complained") complainedMap.set(r.accId, Number(r.n));
  }

  return accts
    .map((a): InboxDeliverability => {
      const ws = warmupStatus(a.warmupStartedAt ?? null, a.cap ?? 30, now);
      const sent = sentMap.get(a.id) ?? 0;
      const bounced = bouncedMap.get(a.id) ?? 0;
      const complained = complainedMap.get(a.id) ?? 0;
      const bounceRate = sent > 0 ? bounced / sent : 0;
      const complaintRate = sent > 0 ? complained / sent : 0;
      const atRisk =
        sent >= MIN_VOLUME_FOR_RISK &&
        (bounceRate > BOUNCE_RATE_LIMIT || complaintRate > COMPLAINT_RATE_LIMIT);
      return {
        id: a.id,
        email: a.email,
        status: a.status,
        paused: a.paused ?? false,
        configuredCap: a.cap ?? 30,
        effectiveCap: ws.cap,
        warming: ws.ramping,
        warmupDaysIn: ws.daysIn,
        sent,
        bounced,
        complained,
        bounceRate,
        complaintRate,
        atRisk,
      };
    })
    .sort((x, y) => Number(y.atRisk) - Number(x.atRisk) || y.sent - x.sent);
}

/** Auto-pause every at-risk inbox that isn't already paused. Returns the count. */
export async function autoPauseAtRiskInboxes(teamId: string): Promise<string[]> {
  const rows = await loadInboxDeliverability(teamId);
  const paused: string[] = [];
  for (const r of rows) {
    if (r.atRisk && !r.paused) {
      await db
        .update(connectedAccounts)
        .set({ coldSendsPaused: true, updatedAt: new Date() })
        .where(eq(connectedAccounts.id, r.id));
      paused.push(r.email);
    }
  }
  return paused;
}
