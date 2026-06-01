import "server-only";

/**
 * Daily team digest — Phase D.4.
 *
 * Once per morning (8am team-local), each operator gets a summary
 * email covering:
 *
 *   - Yesterday: cold sends, replies received, warm/confirmed
 *     classifications, declined/unsubscribed
 *   - Pending now: stale threads owned by them, unacknowledged
 *     @-mentions
 *   - Open AI suggestions waiting for confirmation
 *
 * The digest is generated per-staff (operators see THEIR numbers,
 * not the whole team's) so it's actionable on first read.
 *
 * Delivery: sent FROM the team's primary outreach account TO each
 * staff's primary_email. Uses sendGmailMessage with category =
 * "internal" so it doesn't count against the cold-send cap.
 *
 * Idempotency: digest_sent_at on staff_members tracks the last
 * digest date. Re-running the cron on the same day no-ops.
 *
 * Operators can opt out via user_preferences.daily_digest_enabled
 * (defaults to true; setting NULL is treated as opt-in).
 */

import { emailThreadMentions, emailThreads, staffMembers, userPreferences } from "@/db/schema";
import { db } from "@/lib/db";
import { and, eq, isNull, sql } from "drizzle-orm";

export interface DigestRow {
  staffId: string;
  displayName: string;
  primaryEmail: string;
  teamId: string;
  /** Yesterday's stats for THIS operator. */
  yesterdayColdSends: number;
  yesterdayReplies: number;
  yesterdayWarms: number;
  yesterdayDeclines: number;
  /** Right-now state. */
  staleThreads: number;
  unackMentions: number;
  unconfirmedAiSuggestions: number;
}

export interface DigestRunResult {
  generated: number;
  /** Operators who already got today's digest (no re-send). */
  skippedAlreadySent: number;
  /** Operators who opted out via preferences. */
  skippedOptedOut: number;
}

/**
 * Generate digest rows for every active operator on every team.
 * The caller (cron route) is responsible for actually sending the
 * emails — this function just computes the numbers and returns
 * them.
 */
export async function generateDailyDigests(): Promise<DigestRow[]> {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(yesterday);
  todayStart.setUTCDate(todayStart.getUTCDate() + 1);

  // Load every active staff member with their team + opt-out
  // preference.
  const staff = await db
    .select({
      id: staffMembers.id,
      teamId: staffMembers.teamId,
      displayName: staffMembers.displayName,
      primaryEmail: staffMembers.primaryEmail,
      digestEnabled: userPreferences.dailyDigestEnabled,
    })
    .from(staffMembers)
    .leftJoin(userPreferences, eq(userPreferences.userId, staffMembers.id))
    .where(eq(staffMembers.status, "active"));

  const rows: DigestRow[] = [];

  for (const s of staff) {
    // Honor opt-out — explicit false skips; NULL = opted in.
    if (s.digestEnabled === false) continue;
    if (!s.primaryEmail) continue;

    // Yesterday cold sends — this operator only.
    const sendRows = await db.execute<{ cold: number; warm: number }>(sql`
      SELECT
        SUM(CASE WHEN category = 'cold' THEN 1 ELSE 0 END)::int AS cold,
        SUM(CASE WHEN category != 'cold' THEN 1 ELSE 0 END)::int AS warm
      FROM email_send_events
      WHERE sent_by_user_id = ${s.id}
        AND sent_at >= ${yesterday}
        AND sent_at < ${todayStart}
    `);
    const sendList = unwrapRows<{ cold: number; warm: number }>(sendRows);
    const yesterdayColdSends = Number(sendList[0]?.cold ?? 0);

    // Yesterday replies on threads assigned to this operator.
    const replyRows = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n
      FROM email_messages em
      INNER JOIN email_threads et ON et.id = em.thread_id
      WHERE em.direction = 'inbound'
        AND em.received_at >= ${yesterday}
        AND em.received_at < ${todayStart}
        AND et.assigned_staff_id = ${s.id}
    `);
    const yesterdayReplies = Number(unwrapRows<{ n: number }>(replyRows)[0]?.n ?? 0);

    // Yesterday classification flips to warm/confirmed and to decline
    // (counted by current classification on threads with activity
    // yesterday — close enough for a daily digest).
    const classRows = await db.execute<{ warm: number; decl: number }>(sql`
      SELECT
        SUM(CASE WHEN classification IN ('interested', 'warm', 'confirmed') THEN 1 ELSE 0 END)::int AS warm,
        SUM(CASE WHEN classification IN ('decline', 'unsubscribe') THEN 1 ELSE 0 END)::int AS decl
      FROM email_threads
      WHERE assigned_staff_id = ${s.id}
        AND last_inbound_at >= ${yesterday}
        AND last_inbound_at < ${todayStart}
    `);
    const classList = unwrapRows<{ warm: number; decl: number }>(classRows);
    const yesterdayWarms = Number(classList[0]?.warm ?? 0);
    const yesterdayDeclines = Number(classList[0]?.decl ?? 0);

    // Right-now: stale threads owned by this operator.
    const staleRows = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(emailThreads)
      .where(and(eq(emailThreads.assignedStaffId, s.id), eq(emailThreads.isStale, true)));
    const staleThreads = Number(staleRows[0]?.n ?? 0);

    // Right-now: unacknowledged @-mentions.
    const mentionRows = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(emailThreadMentions)
      .where(
        and(
          eq(emailThreadMentions.mentionedUserId, s.id),
          isNull(emailThreadMentions.acknowledgedAt),
        ),
      );
    const unackMentions = Number(mentionRows[0]?.n ?? 0);

    // Right-now: AI suggestions waiting for confirmation
    // (threads still marked unclassified that have an AI
    // suggestion). Scoped to this operator's assigned threads.
    const suggRows = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n
      FROM email_threads
      WHERE assigned_staff_id = ${s.id}
        AND classification = 'unclassified'
        AND suggested_classification IS NOT NULL
    `);
    const unconfirmedAiSuggestions = Number(unwrapRows<{ n: number }>(suggRows)[0]?.n ?? 0);

    rows.push({
      staffId: s.id,
      teamId: s.teamId,
      displayName: s.displayName,
      primaryEmail: s.primaryEmail,
      yesterdayColdSends,
      yesterdayReplies,
      yesterdayWarms,
      yesterdayDeclines,
      staleThreads,
      unackMentions,
      unconfirmedAiSuggestions,
    });
  }

  return rows;
}

/** Render a digest row as a plain-text email body. The body is
 *  intentionally short — operators glance at this, they don't read it. */
export function renderDigestBody(row: DigestRow): string {
  const lines: string[] = [];
  lines.push(`Good morning, ${row.displayName.split(/\s+/)[0] ?? row.displayName}.`);
  lines.push("");
  lines.push("YESTERDAY");
  lines.push(`  Cold sends:           ${row.yesterdayColdSends}`);
  lines.push(`  Replies received:     ${row.yesterdayReplies}`);
  lines.push(`  Warm or better:       ${row.yesterdayWarms}`);
  if (row.yesterdayDeclines > 0) {
    lines.push(`  Declined / unsubbed:  ${row.yesterdayDeclines}`);
  }
  lines.push("");

  const todoItems: string[] = [];
  if (row.unackMentions > 0) {
    todoItems.push(
      `  ${row.unackMentions} @-mention${row.unackMentions === 1 ? "" : "s"} waiting for you`,
    );
  }
  if (row.staleThreads > 0) {
    todoItems.push(
      `  ${row.staleThreads} stale thread${row.staleThreads === 1 ? "" : "s"} need a reply`,
    );
  }
  if (row.unconfirmedAiSuggestions > 0) {
    todoItems.push(
      `  ${row.unconfirmedAiSuggestions} AI classification${row.unconfirmedAiSuggestions === 1 ? "" : "s"} to confirm`,
    );
  }

  if (todoItems.length > 0) {
    lines.push("OPEN");
    lines.push(...todoItems);
    lines.push("");
  } else {
    lines.push("Nothing pending. Quiet start.");
    lines.push("");
  }

  lines.push("Open the inbox: https://outreach.barcrawlconnect.com/inbox");
  lines.push("");
  // Self-service opt-out link. Operators receiving this in their
  // inbox have no other path to disable the digest -- they'd have
  // to log in and find /me/preferences. Surfacing the URL here is
  // standard practice (and the right thing to do; a daily email
  // with no unsubscribe path is the kind of thing operators
  // remember when they're filing a complaint).
  lines.push("Stop these emails: https://outreach.barcrawlconnect.com/me/preferences");
  return lines.join("\n");
}

// =========================================================================
// Helpers
// =========================================================================

function unwrapRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (
    typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown[] }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}
