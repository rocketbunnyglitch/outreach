/**
 * Stale-tagger — periodic worker that flags inbox threads as stale
 * based on SLA rules from the spec.
 *
 * Rules (v1, time thresholds adjustable):
 *
 *   1. needs_reply with last inbound > 4 business hours ago        → stale
 *   2. waiting_on_them with last outbound > 7 days ago + no inbound → stale
 *   3. follow_up_due with last outbound > 4 days ago                → stale
 *
 * "Business hours" simplification: 4 actual hours. We don't have
 * an office-hours model yet; this errs on the side of flagging
 * MORE threads stale (which is fine — operators can dismiss).
 *
 * What gets set:
 *   - is_stale = true
 *   - stale_since = now() if it wasn't already stale (preserves
 *     the original tag time so the UI can show "stale for 6h"
 *     rather than "stale 1m" after every cron tick)
 *   - stale_reason = short human-readable string
 *
 * What gets UN-set automatically:
 *   - The tagger CLEARS is_stale on threads that no longer meet a
 *     stale rule (e.g. operator replied, thread state changed to
 *     closed). This makes operator action propagate without a
 *     separate hook.
 *
 * Performance: one UPDATE per rule, scoped to currently-open threads
 * with the relevant state. Indexed by state + lastInboundAt /
 * lastOutboundAt (already in 0020_inbox.sql). Designed for 5-15min
 * cron schedule.
 */

import "server-only";
import { emailThreads } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, eq, or, sql } from "drizzle-orm";

const NEEDS_REPLY_HOURS = 4;
const WAITING_DAYS = 7;
const FOLLOW_UP_DAYS = 4;

export interface StaleTaggerResult {
  /** Threads newly flagged as stale (was false → true). */
  newlyStale: number;
  /** Threads cleared (was true → false because they no longer meet
   *  any stale rule). */
  cleared: number;
}

/**
 * Run the stale-tagger. Idempotent — running it twice in a row
 * yields the same final state. Safe to invoke from a cron route.
 */
export async function runStaleTagger(): Promise<StaleTaggerResult> {
  const now = new Date();
  const needsReplyCutoff = new Date(now.getTime() - NEEDS_REPLY_HOURS * 60 * 60 * 1000);
  const waitingCutoff = new Date(now.getTime() - WAITING_DAYS * 24 * 60 * 60 * 1000);
  const followUpCutoff = new Date(now.getTime() - FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000);

  // Build a single CASE expression that decides each thread's new
  // stale state in one pass. The query touches every open thread
  // exactly once.
  //
  // Reason strings are crafted to match the spec examples
  // ("Stale because venue replied 26 hours ago..."). The UI shows
  // these as tooltips on the stale chip.

  const updated = await db.execute<{
    id: string;
    was_stale: boolean;
    now_stale: boolean;
  }>(sql`
    WITH classified AS (
      SELECT
        id,
        is_stale AS was_stale,
        CASE
          -- Rule 1: needs_reply over the 4-hour SLA
          WHEN state = 'needs_reply'
               AND last_inbound_at IS NOT NULL
               AND last_inbound_at < ${needsReplyCutoff}
            THEN true

          -- Rule 2: waiting_on_them with no reply for 7 days
          WHEN state = 'waiting_on_them'
               AND last_outbound_at IS NOT NULL
               AND last_outbound_at < ${waitingCutoff}
            THEN true

          -- Rule 3: follow_up_due past the 4-day cold-no-reply mark
          WHEN state = 'follow_up_due'
               AND last_outbound_at IS NOT NULL
               AND last_outbound_at < ${followUpCutoff}
            THEN true

          ELSE false
        END AS now_stale,
        CASE
          WHEN state = 'needs_reply'
               AND last_inbound_at IS NOT NULL
               AND last_inbound_at < ${needsReplyCutoff}
            THEN 'Venue replied over ' || EXTRACT(EPOCH FROM (NOW() - last_inbound_at))::int / 3600 || ' hours ago; no staff response.'
          WHEN state = 'waiting_on_them'
               AND last_outbound_at IS NOT NULL
               AND last_outbound_at < ${waitingCutoff}
            THEN 'Awaiting reply ' || EXTRACT(EPOCH FROM (NOW() - last_outbound_at))::int / 86400 || ' days since last send.'
          WHEN state = 'follow_up_due'
               AND last_outbound_at IS NOT NULL
               AND last_outbound_at < ${followUpCutoff}
            THEN 'Follow-up overdue ' || EXTRACT(EPOCH FROM (NOW() - last_outbound_at))::int / 86400 || ' days after first send.'
          ELSE NULL
        END AS new_reason
      FROM email_threads
      WHERE state IN ('needs_reply', 'waiting_on_them', 'follow_up_due')
    )
    UPDATE email_threads et
    SET
      is_stale = c.now_stale,
      stale_since = CASE
        WHEN c.now_stale AND NOT c.was_stale THEN NOW()
        WHEN NOT c.now_stale THEN NULL
        ELSE et.stale_since
      END,
      stale_reason = CASE
        WHEN c.now_stale THEN c.new_reason
        ELSE NULL
      END
    FROM classified c
    WHERE et.id = c.id
      AND c.now_stale IS DISTINCT FROM c.was_stale
    RETURNING et.id, c.was_stale, c.now_stale
  `);

  const rows = Array.isArray(updated)
    ? (updated as unknown as Array<{ was_stale: boolean; now_stale: boolean }>)
    : ((updated as unknown as { rows: Array<{ was_stale: boolean; now_stale: boolean }> }).rows ??
      []);

  let newlyStale = 0;
  let cleared = 0;
  for (const r of rows) {
    if (r.now_stale && !r.was_stale) newlyStale++;
    else if (!r.now_stale && r.was_stale) cleared++;
  }

  // Also clear stale on threads whose state moved to closed/archived
  // since the last run — the rule-set above only touches open
  // states, so closed threads with is_stale=true linger otherwise.
  await db
    .update(emailThreads)
    .set({ isStale: false, staleSince: null, staleReason: null })
    .where(
      and(
        eq(emailThreads.isStale, true),
        or(
          eq(emailThreads.state, "closed_won"),
          eq(emailThreads.state, "closed_lost"),
          eq(emailThreads.state, "closed_dnc"),
          eq(emailThreads.state, "archived"),
        ),
      ),
    );

  logger.info({ newlyStale, cleared }, "stale-tagger run complete");
  return { newlyStale, cleared };
}

/** When operator takes action on a thread, call this to clear stale
 *  immediately (don't wait for next cron tick). */
export async function clearStaleOnAction(threadId: string): Promise<void> {
  await db
    .update(emailThreads)
    .set({ isStale: false, staleSince: null, staleReason: null })
    .where(and(eq(emailThreads.id, threadId), eq(emailThreads.isStale, true)));
}
