"use server";

/**
 * Admin → run the rule-based triage classifier across all currently-
 * unclassified email threads.
 *
 * Why this exists
 * ---------------
 * The classifier (lib/triage-classifier.ts) runs in gmail-poll-worker.ts
 * on every inbound message AS IT ARRIVES. But:
 *   1. Threads that arrived BEFORE we shipped the classifier are stuck
 *      at the schema default "unclassified" forever.
 *   2. When we add new rules / refine patterns in triage-classifier.ts,
 *      old "unclassified" threads aren't auto-reclassified.
 *
 * This action sweeps the inbox: find every thread WHERE classification
 * = 'unclassified', pull the LATEST INBOUND message on the thread, run
 * classifyInboundEmail() on it, write the result back.
 *
 * Guarantees
 * ----------
 * - Admin-only (requireAdmin)
 * - NEVER overwrites a non-unclassified value. If an operator manually
 *   reclassified a thread (or the live classifier picked something
 *   else), the backfill leaves it alone. The WHERE clause is the only
 *   guard — the action doesn't even SELECT non-unclassified rows.
 * - Idempotent: running twice in a row produces the same final state
 *   the second time (no rows touched).
 * - Bounded: processes at most BATCH_SIZE rows per invocation. The
 *   admin UI shows the unprocessed count so the operator can re-run.
 *
 * Why a batch limit
 * -----------------
 * - Server-action time budget: ~30s before Vercel/Next default abort.
 * - 1000 thread classifications take ~5s; 10k take ~50s and would risk
 *   timing out. 1000 is comfortably within budget and lets the operator
 *   see results faster.
 * - If the operator has a huge backlog, multiple clicks are fine — the
 *   action is idempotent so back-to-back invocations chip away at the
 *   queue without conflict.
 */

import { emailMessages, emailThreads } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { classifyInboundEmail } from "@/lib/triage-classifier";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const BATCH_SIZE = 1000;

export interface ClassifierBackfillResult {
  totalUnclassifiedBefore: number;
  processed: number;
  classified: number;
  /** Rows kept as 'unclassified' because the classifier fell through. */
  stillUnclassified: number;
  /** Rows skipped because the thread had no inbound message yet. */
  noInboundMessage: number;
  remaining: number;
}

/**
 * Count how many threads are currently unclassified — surfaces a
 * "still N to go" hint in the admin UI.
 */
export async function getUnclassifiedCount(): Promise<number> {
  await requireAdmin();
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(emailThreads)
    .where(eq(emailThreads.classification, "unclassified"));
  return row?.n ?? 0;
}

/**
 * Run one batch of the classifier backfill. Returns counts so the UI
 * can show progress + how many remain.
 */
export async function runClassifierBackfill(): Promise<ActionResult<ClassifierBackfillResult>> {
  const { staff } = await requireAdmin();

  // Snapshot the total before we touch anything — feeds the UI's
  // "X to go" line.
  const totalBefore = await getUnclassifiedCount();
  if (totalBefore === 0) {
    return {
      ok: true,
      data: {
        totalUnclassifiedBefore: 0,
        processed: 0,
        classified: 0,
        stillUnclassified: 0,
        noInboundMessage: 0,
        remaining: 0,
      },
    };
  }

  // Pull the candidate threads — only unclassified, bounded by BATCH.
  const candidates = await db
    .select({
      threadId: emailThreads.id,
    })
    .from(emailThreads)
    .where(eq(emailThreads.classification, "unclassified"))
    .limit(BATCH_SIZE);

  let processed = 0;
  let classified = 0;
  let stillUnclassified = 0;
  let noInboundMessage = 0;

  try {
    for (const candidate of candidates) {
      processed++;
      // Find the latest INBOUND message on this thread. Outbound
      // messages don't carry signal for triage — classifying based
      // on what WE sent isn't meaningful.
      const [latest] = await db
        .select({
          subject: emailMessages.subject,
          bodyText: emailMessages.bodyText,
          fromAddress: emailMessages.fromAddress,
        })
        .from(emailMessages)
        .where(
          and(
            eq(emailMessages.threadId, candidate.threadId),
            eq(emailMessages.direction, "inbound"),
          ),
        )
        .orderBy(sql`${emailMessages.sentAt} DESC`)
        .limit(1);

      if (!latest) {
        // Outbound-only thread — happens for our cold-outreach sends
        // that haven't received a reply yet. Don't touch; stays
        // unclassified (which is correct semantically).
        noInboundMessage++;
        continue;
      }

      const result = classifyInboundEmail({
        subject: latest.subject,
        bodyText: latest.bodyText,
        fromAddress: latest.fromAddress,
      });

      // If the classifier still returns 'unclassified', skip the
      // write — the thread's value is already 'unclassified' and a
      // no-op UPDATE would still trigger audit log entries.
      if (result.classification === "unclassified") {
        stillUnclassified++;
        continue;
      }

      await db
        .update(emailThreads)
        .set({
          classification: result.classification,
        })
        .where(
          and(
            eq(emailThreads.id, candidate.threadId),
            // Belt-and-suspenders: even though we filtered above,
            // re-assert the unclassified guard in the WHERE so a
            // concurrent operator override can't be stomped.
            eq(emailThreads.classification, "unclassified"),
          ),
        );

      classified++;
    }
  } catch (err) {
    logger.error({ err, staffId: staff.id }, "classifier backfill failed mid-batch");
    return {
      ok: false,
      error: `Backfill failed after ${classified} classifications. See server logs.`,
    };
  }

  const remaining = Math.max(0, totalBefore - classified - stillUnclassified - noInboundMessage);

  logger.info(
    {
      staffId: staff.id,
      totalBefore,
      processed,
      classified,
      stillUnclassified,
      noInboundMessage,
      remaining,
    },
    "classifier backfill batch complete",
  );

  // Revalidate inbox + admin so the badges + counts refresh.
  revalidatePath("/admin");
  revalidatePath("/inbox");

  return {
    ok: true,
    data: {
      totalUnclassifiedBefore: totalBefore,
      processed,
      classified,
      stillUnclassified,
      noInboundMessage,
      remaining,
    },
  };
}
