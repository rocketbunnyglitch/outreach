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

// Operators get a full day before a venue reply reads as "Overdue" -- the team
// works city queues, not a 24/7 support desk, so a same-day reply shouldn't be
// flagged within hours. (Was 4h; bumped to 24h per operator.)
const NEEDS_REPLY_HOURS = 24;
const WAITING_DAYS = 7;
const FOLLOW_UP_DAYS = 4;
/**
 * Tighter threshold for "high intent" waiting_on_them threads. When
 * the venue's last classification was interested / confirmed /
 * callback_requested and we sent the next step, we expect a faster
 * back-and-forth. Going silent for 24h on a hot lead is an
 * escalation signal — surfacing it sooner than the generic 7-day
 * waiting threshold gives operators a fighting chance to re-engage
 * before momentum dies.
 *
 * The classification enum has these "intent-positive" kinds:
 *   - interested
 *   - confirmed
 *   - callback_requested
 * Other kinds (warm, question, etc.) stay on the default
 * WAITING_DAYS schedule — they're less time-sensitive.
 */
const HIGH_INTENT_WAITING_HOURS = 24;

/**
 * Even tighter threshold for UNASSIGNED inbound. A thread with no
 * operator assigned (assigned_staff_id IS NULL) means nobody is
 * watching it -- the team's shared inbox just received mail and
 * nobody owns the response yet. One hour is the line: if a reply
 * lands in the team inbox and isn't picked up within an hour,
 * surface it as stale so a team lead can assign it before the
 * generic 4-hour Rule 1 catches it later.
 *
 * This rule was previously implemented as a separate aux pass
 * that ran after the canonical tagger, which had a known
 * timestamp-churn bug: the main tagger would clear is_stale on
 * each tick (the thread didn't yet meet Rule 1 at 1h-4h), then
 * the aux pass would re-flag it with stale_since = NOW(), so the
 * "stale for X minutes" counter in the UI reset every cron tick.
 * Folding it into the canonical CASE here so it's evaluated in
 * the same UPDATE pass as the other rules; the preserved-
 * stale_since branch (CASE WHEN is_stale THEN stale_since ELSE
 * NOW() END) works correctly across rule transitions.
 */
// Unassigned inbound used to flag at 1h, but the team works city queues where
// threads stay unassigned by design, so that flagged almost everything within
// the hour. Aligned to the same 1-day grace as Rule 1 per operator.
const UNASSIGNED_INBOUND_HOURS = 24;

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
  const highIntentWaitingCutoff = new Date(
    now.getTime() - HIGH_INTENT_WAITING_HOURS * 60 * 60 * 1000,
  );
  const unassignedInboundCutoff = new Date(
    now.getTime() - UNASSIGNED_INBOUND_HOURS * 60 * 60 * 1000,
  );

  // Build a single CASE expression that decides each thread's new
  // stale state in one pass. The query touches every open thread
  // exactly once.
  //
  // Reasons are crafted to match the spec's commitment that "Stale
  // reasons must explain themselves" — example from the spec:
  //
  //   "Stale because Mike from Lavelle replied 26 hours ago and
  //    no staff response has been sent."
  //
  // To get there, we LEFT JOIN venues so the reason can include
  // the venue name when the thread is matched ("from Lavelle").
  // last_sender_name is denormalized on email_threads (the poll
  // worker stamps it on each inbound) so we can build "Mike from
  // Lavelle" without a join to email_messages. Falls back
  // gracefully: when venue_id is null the reason omits the
  // "from X" clause; when last_sender_name is null it omits the
  // sender name part.
  //
  // The duration math uses EXTRACT(EPOCH...) / 3600 for hours and
  // / 86400 for days. The "1 day"/"2 days" pluralization is done
  // in SQL via a CASE to keep the reason readable.

  const updated = await db.execute<{
    id: string;
    was_stale: boolean;
    now_stale: boolean;
  }>(sql`
    WITH classified AS (
      SELECT
        t.id,
        t.is_stale AS was_stale,
        CASE
          -- Rule 5: UNASSIGNED needs_reply over the 1-hour tight SLA.
          -- A thread with no assignee + inbound mail sitting > 1h
          -- means nobody on the team owns the response yet. Tighter
          -- threshold than Rule 1; checked first so the
          -- "unassigned" reason wins for any thread that matches
          -- both rules (assigned 4h vs unassigned 1h).
          WHEN t.state = 'needs_reply'
               AND t.assigned_staff_id IS NULL
               AND t.last_inbound_at IS NOT NULL
               AND t.last_inbound_at < ${unassignedInboundCutoff}
            THEN true

          -- Rule 1: needs_reply over the 4-hour SLA
          WHEN t.state = 'needs_reply'
               AND t.last_inbound_at IS NOT NULL
               AND t.last_inbound_at < ${needsReplyCutoff}
            THEN true

          -- Rule 4: HIGH-INTENT waiting_on_them — when the venue's
          -- last reply was classified interested / confirmed /
          -- callback_requested AND we sent the next step, going
          -- silent for 24h is an escalation signal. This rule
          -- fires BEFORE Rule 2 (looser 7-day waiting) for
          -- intent-positive threads. Checked before Rule 2 in the
          -- CASE so the tighter threshold wins.
          WHEN t.state = 'waiting_on_them'
               AND t.classification IN ('interested', 'confirmed', 'callback_requested')
               AND t.last_outbound_at IS NOT NULL
               AND t.last_outbound_at < ${highIntentWaitingCutoff}
            THEN true

          -- Rule 2: waiting_on_them with no reply for 7 days
          WHEN t.state = 'waiting_on_them'
               AND t.last_outbound_at IS NOT NULL
               AND t.last_outbound_at < ${waitingCutoff}
            THEN true

          -- Rule 3: follow_up_due past the 4-day cold-no-reply mark
          WHEN t.state = 'follow_up_due'
               AND t.last_outbound_at IS NOT NULL
               AND t.last_outbound_at < ${followUpCutoff}
            THEN true

          ELSE false
        END AS now_stale,
        CASE
          -- Rule 5 reason: "Unassigned inbound from Lavelle sitting
          -- 42 minutes; assign an owner." Matches the order of the
          -- now_stale CASE -- the unassigned-specific reason wins
          -- whenever both Rule 5 and Rule 1 match the same thread.
          -- Minutes (not hours) because the threshold is 1h; the
          -- reason text needs to communicate "this is fresh and
          -- nobody owns it."
          WHEN t.state = 'needs_reply'
               AND t.assigned_staff_id IS NULL
               AND t.last_inbound_at IS NOT NULL
               AND t.last_inbound_at < ${unassignedInboundCutoff}
            THEN
              'Unassigned inbound '
              || CASE WHEN v.name IS NOT NULL THEN 'from ' || v.name || ' ' ELSE '' END
              || 'sitting '
              || EXTRACT(EPOCH FROM (NOW() - t.last_inbound_at))::int / 3600
              || CASE WHEN EXTRACT(EPOCH FROM (NOW() - t.last_inbound_at))::int / 3600 = 1
                     THEN ' hour; assign an owner.'
                     ELSE ' hours; assign an owner.'
                  END

          -- Rule 1 reason: "Mike from Lavelle replied 26 hours ago;
          -- no staff response." Both name pieces are optional.
          WHEN t.state = 'needs_reply'
               AND t.last_inbound_at IS NOT NULL
               AND t.last_inbound_at < ${needsReplyCutoff}
            THEN
              CASE WHEN t.last_sender_name IS NOT NULL THEN t.last_sender_name || ' ' ELSE '' END
              ||
              CASE WHEN v.name IS NOT NULL THEN 'from ' || v.name || ' ' ELSE '' END
              || 'replied '
              || EXTRACT(EPOCH FROM (NOW() - t.last_inbound_at))::int / 3600
              || CASE WHEN EXTRACT(EPOCH FROM (NOW() - t.last_inbound_at))::int / 3600 = 1
                     THEN ' hour ago; no staff response.'
                     ELSE ' hours ago; no staff response.'
                  END

          -- Rule 4 reason: "Interested lead Lavelle silent 28
          -- hours; consider a nudge." Surfaces the intent
          -- classification so operators understand WHY this is
          -- stale faster than a default waiting thread.
          WHEN t.state = 'waiting_on_them'
               AND t.classification IN ('interested', 'confirmed', 'callback_requested')
               AND t.last_outbound_at IS NOT NULL
               AND t.last_outbound_at < ${highIntentWaitingCutoff}
            THEN
              CASE t.classification::text
                WHEN 'interested' THEN 'Interested lead '
                WHEN 'confirmed' THEN 'Confirmed lead '
                WHEN 'callback_requested' THEN 'Callback-requested lead '
                ELSE 'High-intent lead '
              END
              || COALESCE(v.name, 'venue')
              || ' silent '
              || EXTRACT(EPOCH FROM (NOW() - t.last_outbound_at))::int / 3600
              || CASE WHEN EXTRACT(EPOCH FROM (NOW() - t.last_outbound_at))::int / 3600 = 1
                     THEN ' hour; consider a nudge.'
                     ELSE ' hours; consider a nudge.'
                  END

          -- Rule 2 reason: "Lavelle hasn't replied for 9 days since
          -- last send." Venue name optional.
          WHEN t.state = 'waiting_on_them'
               AND t.last_outbound_at IS NOT NULL
               AND t.last_outbound_at < ${waitingCutoff}
            THEN
              CASE WHEN v.name IS NOT NULL THEN v.name || ' hasn''t replied for '
                   ELSE 'Awaiting reply ' END
              || EXTRACT(EPOCH FROM (NOW() - t.last_outbound_at))::int / 86400
              || CASE WHEN EXTRACT(EPOCH FROM (NOW() - t.last_outbound_at))::int / 86400 = 1
                     THEN ' day since last send.'
                     ELSE ' days since last send.'
                  END

          -- Rule 3 reason: "Follow-up overdue: 5 days after first
          -- send to Lavelle." Venue name optional.
          WHEN t.state = 'follow_up_due'
               AND t.last_outbound_at IS NOT NULL
               AND t.last_outbound_at < ${followUpCutoff}
            THEN
              'Follow-up overdue: '
              || EXTRACT(EPOCH FROM (NOW() - t.last_outbound_at))::int / 86400
              || CASE WHEN EXTRACT(EPOCH FROM (NOW() - t.last_outbound_at))::int / 86400 = 1
                     THEN ' day after first send'
                     ELSE ' days after first send'
                  END
              || CASE WHEN v.name IS NOT NULL THEN ' to ' || v.name || '.' ELSE '.' END

          ELSE NULL
        END AS new_reason
      FROM email_threads t
      LEFT JOIN venues v ON v.id = t.venue_id
      WHERE t.state IN ('needs_reply', 'waiting_on_them', 'follow_up_due')
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

  // Retro-link venue matches (FULL_AUDIT P009, 2026-06-11): threads that
  // arrived BEFORE their venue existed never get matched — ingest-time
  // matching can't see the future, and nothing healed them afterwards
  // (27 such threads found at audit baseline). Nightly: link unmatched
  // threads whose latest inbound sender exactly equals a venue's primary
  // email (confidence 1.0 by definition). Domain-level retro-matching
  // stays manual — too fuzzy to automate silently.
  try {
    const relinked = await db.execute(sql`
      WITH unmatched AS (
        SELECT t.id, lower((regexp_match(m.from_address, '<([^>]+)>'))[1]) AS addr
        FROM email_threads t
        JOIN LATERAL (
          SELECT from_address FROM email_messages
          WHERE thread_id = t.id AND direction = 'inbound'
          ORDER BY sent_at DESC LIMIT 1
        ) m ON true
        WHERE t.archived_at IS NULL AND t.venue_id IS NULL
      )
      UPDATE email_threads t
      SET venue_id = v.id, updated_at = NOW()
      FROM unmatched u
      JOIN venues v ON lower(v.email) = u.addr AND v.archived_at IS NULL
      WHERE t.id = u.id
    `);
    const n = Number((relinked as unknown as { rowCount?: number }).rowCount ?? 0);
    if (n > 0) logger.info({ relinked: n }, "stale-tagger: retro-linked threads to venues");

    // P012: venue-linked threads with NO campaign attribution drop out of
    // every campaign-scoped view (city inbox, NBA warm loaders, learning
    // stats). When the venue sits in exactly ONE active city-campaign the
    // attribution is unambiguous — backfill it. Ambiguous venues stay
    // null for a human to attribute.
    //
    // SEMANTIC GUARD (P075 follow-up): "single active campaign" is only a
    // mechanical signal. A thread whose SUBJECT names a different operation
    // (St. Patrick's, NYE, FIFA, July 4th — imported-history chatter) must
    // never be stamped with the Halloween campaign just because that's the
    // only active one. Those stay NULL and surface on /admin/data-quality
    // for human attribution. Keep this regex in sync with
    // scripts/audit-data-links.sh (threads_venue_no_cc_unambig) and the
    // needs_manual_attribution data-quality card.
    const ccFilled = await db.execute(sql`
      WITH single_cc AS (
        SELECT coe.venue_id, min(coe.city_campaign_id::text)::uuid AS cc_id
        FROM cold_outreach_entries coe
        JOIN city_campaigns cc ON cc.id = coe.city_campaign_id
        JOIN campaigns c ON c.id = cc.campaign_id
        WHERE coe.archived_at IS NULL AND c.archived_at IS NULL
        GROUP BY coe.venue_id
        HAVING count(DISTINCT coe.city_campaign_id) = 1
      )
      UPDATE email_threads t
      SET city_campaign_id = s.cc_id, updated_at = NOW()
      FROM single_cc s
      WHERE s.venue_id = t.venue_id
        AND t.archived_at IS NULL AND t.city_campaign_id IS NULL
        AND t.subject !~* 'st\\.?\\s*patrick|paddy|nye|new year|fifa|july\\s*4|4th of july|canada day|christmas|valentine'
    `);
    const nc = Number((ccFilled as unknown as { rowCount?: number }).rowCount ?? 0);
    if (nc > 0)
      logger.info({ ccFilled: nc }, "stale-tagger: backfilled thread campaign attribution");

    // Final link in the heal chain (venue -> campaign -> touch): the two
    // backfills above can create NEW (venue, cc) attribution for old
    // outbound mail, which the cold-entry touch never saw. Re-sync so a
    // freshly-attributed venue doesn't read as untouched.
    const touched = await db.execute(sql`
      UPDATE cold_outreach_entries coe
      SET last_touch_at = m.max_sent, updated_at = NOW()
      FROM (SELECT t.venue_id, t.city_campaign_id, max(m2.sent_at) AS max_sent
            FROM email_messages m2 JOIN email_threads t ON t.id = m2.thread_id
            WHERE m2.direction = 'outbound' AND t.venue_id IS NOT NULL
              AND t.city_campaign_id IS NOT NULL
            GROUP BY 1, 2) m
      WHERE coe.venue_id = m.venue_id AND coe.city_campaign_id = m.city_campaign_id
        AND coe.archived_at IS NULL
        AND (coe.last_touch_at IS NULL OR coe.last_touch_at < m.max_sent)
    `);
    const nt = Number((touched as unknown as { rowCount?: number }).rowCount ?? 0);
    if (nt > 0) logger.info({ touched: nt }, "stale-tagger: re-synced cold-entry touches");
  } catch (err) {
    logger.warn({ err }, "stale-tagger: retro-link step failed (non-fatal)");
  }

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
