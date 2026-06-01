import "server-only";

/**
 * Auxiliary stale rules -- a SECOND, complementary stale-flagging pass
 * that runs right after the canonical runStaleTagger() in the same
 * cron tick.
 *
 * Why this lives separately from lib/stale-tagger.ts
 * --------------------------------------------------
 * lib/stale-tagger.ts is the canonical home for stale rules, but it is
 * frozen in this work cycle (owned by another track), so the new rule
 * could not be added to its single-pass CASE expression. This module
 * is the interim home. A future consolidation should fold this rule
 * back into the stale-tagger's CASE -- see the interaction note below
 * for why that matters.
 *
 * The rule (spec: "Inbound message on an unassigned thread > 1 hour =
 * Stale")
 * --------------------------------------------------------------------
 * Mail that lands in a shared inbox with no operator assigned is more
 * urgent than an assigned-but-pending thread: nobody is watching it.
 * The main tagger's Rule 1 (needs_reply with last inbound > 4h) would
 * eventually catch these too, but four hours is far too long for an
 * unowned thread. This pass flags them at one hour instead.
 *
 * Targets threads where ALL of:
 *   - state = 'needs_reply'
 *   - assigned_staff_id IS NULL          (nobody owns it)
 *   - last_inbound_at IS NOT NULL
 *   - last_inbound_at < NOW() - 1 hour
 *   - is_stale = false                   (the guard, see below)
 *
 * The is_stale = false guard
 * --------------------------
 * Because this runs AFTER runStaleTagger() in the same tick, any
 * unassigned thread already past the main tagger's 4h Rule 1 will have
 * been flagged with that rule's (more specific) reason. The guard
 * makes this pass skip those rather than overwrite their reason -- it
 * only newly-flags threads sitting in the 1h-to-4h window that the
 * main tagger does not yet consider stale.
 *
 * INTERACTION NOTE (known interim limitation)
 * -------------------------------------------
 * runStaleTagger() CLEARS is_stale on any open thread that no longer
 * meets one of ITS rules. A thread this pass flags in the 1h-4h window
 * is, to the main tagger, a not-yet-stale needs_reply thread -- so on
 * the next tick the main tagger (which runs first) will clear the flag,
 * and this pass will immediately re-flag it. Net effect: the thread is
 * correctly flagged at the END of every tick, but its stale_since is
 * reset to NOW() each tick rather than preserved from first detection.
 * Folding this rule into the stale-tagger's single CASE (the future
 * consolidation) removes the fight and makes stale_since stable. Until
 * then this is an accepted, documented cost of keeping the canonical
 * file untouched.
 *
 * Reason string follows the stale-tagger convention: venue-aware when
 * the thread is attached to a venue, with a graceful fallback when it
 * is not, and minute-count math via EXTRACT(EPOCH ...) / 60 mirroring
 * the hour/day math in the main rules.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

/** Unassigned inbound is flagged stale once it has sat this long. */
const UNASSIGNED_INBOUND_HOURS = 1;

export interface AuxStaleRulesResult {
  /** Threads newly flagged stale by this auxiliary pass. */
  flagged: number;
}

/**
 * Run the auxiliary stale rules. Currently a single rule: flag
 * unassigned inbound threads that have sat longer than
 * UNASSIGNED_INBOUND_HOURS. Best-effort companion to runStaleTagger();
 * intended to be called immediately after it in the stale-tagger cron
 * route.
 *
 * Returns the count of threads newly flagged this pass.
 */
export async function runAuxStaleRules(): Promise<AuxStaleRulesResult> {
  const now = new Date();
  const unassignedCutoff = new Date(now.getTime() - UNASSIGNED_INBOUND_HOURS * 60 * 60 * 1000);

  // Single targeted UPDATE. The CTE builds the venue-aware reason
  // string once (LEFT JOIN venues so an unattached thread still gets a
  // reason), then the UPDATE flags every matching thread. RETURNING
  // gives us the flagged count.
  const updated = await db.execute<{ id: string }>(sql`
    WITH targets AS (
      SELECT
        t.id,
        'Unassigned inbound '
        || CASE WHEN v.name IS NOT NULL THEN 'from ' || v.name || ' ' ELSE '' END
        || 'sitting '
        || EXTRACT(EPOCH FROM (NOW() - t.last_inbound_at))::int / 60
        || CASE WHEN EXTRACT(EPOCH FROM (NOW() - t.last_inbound_at))::int / 60 = 1
               THEN ' minute; assign an owner'
               ELSE ' minutes; assign an owner'
            END AS new_reason
      FROM email_threads t
      LEFT JOIN venues v ON v.id = t.venue_id
      WHERE t.state = 'needs_reply'
        AND t.assigned_staff_id IS NULL
        AND t.last_inbound_at IS NOT NULL
        AND t.last_inbound_at < ${unassignedCutoff}
        AND t.is_stale = false
    )
    UPDATE email_threads et
    SET
      is_stale = true,
      stale_since = NOW(),
      stale_reason = tg.new_reason
    FROM targets tg
    WHERE et.id = tg.id
    RETURNING et.id
  `);

  const rows = Array.isArray(updated)
    ? (updated as unknown as Array<{ id: string }>)
    : ((updated as unknown as { rows: Array<{ id: string }> }).rows ?? []);

  const flagged = rows.length;
  logger.info({ flagged }, "aux stale-rules run complete");
  return { flagged };
}
