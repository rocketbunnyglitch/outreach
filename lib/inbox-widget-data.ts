/**
 * Inbox dashboard widget data loader.
 *
 * Returns:
 *   - the staff member's top "needs reply" threads (their own +
 *     assigned, capped at 8)
 *   - per-inbox send-cap usage rail so the operator sees
 *     "18 / 30 used today" without leaving the dashboard
 *
 * Both surfaces are intentionally compact — the widget is a
 * preview/launcher, not a replacement for /inbox.
 */

import "server-only";
import { emailThreads, staffOutreachEmails, venues } from "@/db/schema";
import { currentCampaignThreadScope } from "@/lib/campaign-thread-scope";
import { db } from "@/lib/db";
import { loadSendUsage } from "@/lib/send-cap";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";

export interface InboxWidgetThread {
  id: string;
  subject: string | null;
  snippet: string | null;
  lastSenderName: string | null;
  lastMessageAt: Date | null;
  venueName: string | null;
  /** True when this thread is assigned to the current user. */
  assignedToMe: boolean;
  /** True when the underlying connected_account is owned by this user. */
  fromMyInbox: boolean;
}

export interface InboxWidgetUsage {
  inboxId: string;
  emailAddress: string;
  used: number;
  cap: number;
  remaining: number;
  atCap: boolean;
}

export interface InboxWidgetData {
  threads: InboxWidgetThread[];
  /** Inboxes the current user OWNS (not all team inboxes — the
   *  widget surfaces "your" send capacity). */
  myInboxes: InboxWidgetUsage[];
  totalNeedsReply: number;
}

const TOP_N = 8;

export async function loadInboxWidget(opts: {
  userId: string;
  teamId: string;
}): Promise<InboxWidgetData> {
  // Threads that need attention from this user: thread.state =
  // 'needs_reply' AND (assigned to me OR from one of my inboxes).
  //
  // We do this as a single query so the widget loads in one round
  // trip. The JOIN on staff_outreach_emails carries the
  // "fromMyInbox" signal.
  // Only the current campaign's mail (gmail label scope, 2026-06-10) --
  // workspace invoices / old-campaign threads don't belong on the dashboard.
  const campaignScope = await currentCampaignThreadScope();
  const threadsRaw = await db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      snippet: emailThreads.snippet,
      lastSenderName: emailThreads.lastSenderName,
      lastMessageAt: emailThreads.lastMessageAt,
      assignedStaffId: emailThreads.assignedStaffId,
      venueName: venues.name,
      inboxOwnerId: staffOutreachEmails.ownerUserId,
    })
    .from(emailThreads)
    .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, emailThreads.staffOutreachEmailId))
    .leftJoin(venues, eq(venues.id, emailThreads.venueId))
    .where(
      and(
        eq(staffOutreachEmails.teamId, opts.teamId),
        eq(emailThreads.state, "needs_reply"),
        campaignScope,
        or(
          eq(emailThreads.assignedStaffId, opts.userId),
          eq(staffOutreachEmails.ownerUserId, opts.userId),
        ),
      ),
    )
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(TOP_N);

  // Count of needs_reply for this user — for the badge.
  // Cheaper as a second small query than fetching all rows.
  const totalRow = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(emailThreads)
    .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, emailThreads.staffOutreachEmailId))
    .where(
      and(
        eq(staffOutreachEmails.teamId, opts.teamId),
        eq(emailThreads.state, "needs_reply"),
        campaignScope,
        or(
          eq(emailThreads.assignedStaffId, opts.userId),
          eq(staffOutreachEmails.ownerUserId, opts.userId),
        ),
      ),
    );
  const totalNeedsReply = totalRow[0]?.n ?? 0;

  const threads: InboxWidgetThread[] = threadsRaw.map((t) => ({
    id: t.id,
    subject: t.subject,
    snippet: t.snippet,
    lastSenderName: t.lastSenderName,
    lastMessageAt: t.lastMessageAt,
    venueName: t.venueName,
    assignedToMe: t.assignedStaffId === opts.userId,
    fromMyInbox: t.inboxOwnerId === opts.userId,
  }));

  // Send-cap rail: every inbox the user OWNS, with today's usage.
  const myInboxRows = await db
    .select({
      id: staffOutreachEmails.id,
      emailAddress: staffOutreachEmails.emailAddress,
    })
    .from(staffOutreachEmails)
    .where(
      and(
        eq(staffOutreachEmails.ownerUserId, opts.userId),
        eq(staffOutreachEmails.teamId, opts.teamId),
      ),
    )
    .orderBy(asc(staffOutreachEmails.emailAddress));

  // Usage per inbox — sequential is fine for a small list.
  const myInboxes: InboxWidgetUsage[] = [];
  for (const ib of myInboxRows) {
    const usage = await loadSendUsage(ib.id);
    myInboxes.push({
      inboxId: ib.id,
      emailAddress: ib.emailAddress,
      used: usage.used,
      cap: usage.cap,
      remaining: usage.remaining,
      atCap: usage.atCap,
    });
  }

  return { threads, myInboxes, totalNeedsReply };
}
