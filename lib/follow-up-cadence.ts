/**
 * Follow-up cadence engine — converts silent cold outreach into
 * either a state flip (follow_up_due) or an auto-task ("Call venue")
 * on a daily schedule.
 *
 * Per the spec (Follow-Up Automation section):
 *
 *   - First follow-up due 4 days after cold send if no reply
 *   - Call task due 7 days after cold send if no reply
 *   - Cadence pauses on reply, bounce, decline, or manual pause
 *
 * Spec also calls out: "optionally schedule follow-up draft, not
 * auto-send unless enabled". This v1 NEVER auto-sends — we only
 * flag threads + create tasks for the operator. Auto-drafting can
 * be a follow-up that builds on top of this engine.
 *
 * State machine per thread (stored on email_threads.follow_up_stage):
 *
 *   0   initial / cold send sitting silent
 *   1   follow_up_due flipped (operator should ping again)
 *   2   call task created (operator should phone)
 *
 * Transitions:
 *
 *   stage=0 && cold-no-reply + 4 days     → stage=1, state=follow_up_due
 *   stage=1 && cold-no-reply + 7 days     → stage=2, auto-create task
 *   stage=2                                → terminal until operator action
 *
 * The engine writes `follow_up_next_due_at` so subsequent runs scan
 * only the threads due to advance. Operator actions (reply,
 * archive, state change to closed) reset the cadence: stage back
 * to 0 with follow_up_next_due_at cleared.
 */

import "server-only";
import { emailThreads } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, eq, lte, sql } from "drizzle-orm";

const STAGE_1_DAYS = 4;
const STAGE_2_DAYS = 7;

export interface CadenceRunResult {
  /** Threads advanced from stage 0 -> 1 (now in follow_up_due). */
  flippedToFollowUp: number;
  /** Threads advanced from stage 1 -> 2 (got an auto-task). */
  tasksCreated: number;
  /** Threads whose cadence was cleared because they no longer
   *  qualify (received a reply, were closed, etc.). */
  cadenceCleared: number;
}

/**
 * Run one pass of the cadence engine. Idempotent — back-to-back
 * runs converge.
 *
 * Designed for a daily cron schedule. Running hourly or every few
 * hours is also fine: each thread only advances when its
 * follow_up_next_due_at has passed, which moves forward in days.
 */
export async function runFollowUpCadence(): Promise<CadenceRunResult> {
  const now = new Date();

  // Step 1: bootstrap cadence for cold-outbound threads that don't
  // have a follow_up_next_due_at yet. Computed via CTE inline; we
  // don't capture the returning ids because the count isn't surfaced.
  await db.execute(sql`
    WITH candidates AS (
      SELECT
        et.id,
        (SELECT MAX(em.sent_at)
         FROM email_messages em
         WHERE em.thread_id = et.id
           AND em.direction = 'outbound') AS last_outbound_at,
        (SELECT COUNT(*) FROM email_messages em
         WHERE em.thread_id = et.id
           AND em.direction = 'inbound') AS inbound_count
      FROM email_threads et
      WHERE et.follow_up_next_due_at IS NULL
        AND et.follow_up_stage = 0
        AND et.state IN ('waiting_on_them', 'needs_reply')
    )
    UPDATE email_threads et
    SET follow_up_next_due_at = c.last_outbound_at + INTERVAL '${sql.raw(String(STAGE_1_DAYS))} days'
    FROM candidates c
    WHERE et.id = c.id
      AND c.inbound_count = 0
      AND c.last_outbound_at IS NOT NULL
    RETURNING et.id
  `);

  // -----------------------------------------------------------------
  // Step 2: clear cadence on threads that no longer qualify. Either
  // they got an inbound reply (any inbound message exists) or their
  // state moved out of the open set.
  // -----------------------------------------------------------------
  const clearedRows = await db
    .update(emailThreads)
    .set({
      followUpStage: 0,
      followUpNextDueAt: null,
    })
    .where(
      and(
        sql`${emailThreads.followUpNextDueAt} IS NOT NULL`,
        sql`(
          EXISTS (
            SELECT 1 FROM email_messages em
            WHERE em.thread_id = ${emailThreads.id}
              AND em.direction = 'inbound'
          )
          OR ${emailThreads.state} NOT IN ('waiting_on_them', 'needs_reply', 'follow_up_due')
        )`,
      ),
    )
    .returning({ id: emailThreads.id });
  const cadenceCleared = clearedRows.length;

  // -----------------------------------------------------------------
  // Step 3: advance stage 0 → 1. Flips state to follow_up_due, sets
  // the next due_at to (last_outbound + STAGE_2_DAYS).
  // -----------------------------------------------------------------
  const stage1Rows = await db.execute<{ id: string }>(sql`
    WITH advancing AS (
      SELECT
        et.id,
        (SELECT MAX(em.sent_at)
         FROM email_messages em
         WHERE em.thread_id = et.id
           AND em.direction = 'outbound') AS last_outbound_at
      FROM email_threads et
      WHERE et.follow_up_stage = 0
        AND et.follow_up_next_due_at IS NOT NULL
        AND et.follow_up_next_due_at <= ${now}
    )
    UPDATE email_threads et
    SET
      follow_up_stage = 1,
      state = 'follow_up_due',
      follow_up_next_due_at = a.last_outbound_at + INTERVAL '${sql.raw(String(STAGE_2_DAYS))} days',
      follow_up_last_advanced_at = NOW()
    FROM advancing a
    WHERE et.id = a.id
      AND a.last_outbound_at IS NOT NULL
    RETURNING et.id
  `);
  const flippedToFollowUp = countRows(stage1Rows);

  // -----------------------------------------------------------------
  // Step 4: advance stage 1 → 2. Create an auto-task per thread.
  //
  // We do this in two steps:
  //   a) find the candidate thread ids (with their assigned staff
  //      and venue context for the task title)
  //   b) insert one task per thread, then bump the thread stage
  //
  // Tasks insertion is bulk; we don't worry about duplicates because
  // step 5 below only marks the thread advanced after the task
  // insert succeeds.
  // -----------------------------------------------------------------
  const stage2Candidates = await db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      assignedStaffId: emailThreads.assignedStaffId,
      lastSenderName: emailThreads.lastSenderName,
    })
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.followUpStage, 1),
        sql`${emailThreads.followUpNextDueAt} IS NOT NULL`,
        lte(emailThreads.followUpNextDueAt, now),
      ),
    );

  let tasksCreated = 0;
  for (const t of stage2Candidates) {
    try {
      await db.execute(sql`
        INSERT INTO tasks (title, description, source, status, target_type, target_id, assigned_staff_id, due_at)
        VALUES (
          ${`Call follow-up: ${t.subject ?? "(no subject)"}`},
          ${`Auto-created by cadence after ${STAGE_2_DAYS} days of no reply on a cold outreach thread. Consider a phone follow-up.`},
          'auto',
          'pending',
          'email_thread',
          ${t.id},
          ${t.assignedStaffId},
          ${now}
        )
      `);
      await db
        .update(emailThreads)
        .set({
          followUpStage: 2,
          followUpNextDueAt: null, // terminal — no further auto-advance
          followUpLastAdvancedAt: now,
        })
        .where(eq(emailThreads.id, t.id));
      tasksCreated++;
    } catch (err) {
      logger.error({ err, threadId: t.id }, "cadence: failed to create stage-2 task");
    }
  }

  logger.info(
    { flippedToFollowUp, tasksCreated, cadenceCleared },
    "follow-up cadence run complete",
  );

  return { flippedToFollowUp, tasksCreated, cadenceCleared };
}

/** Drizzle's db.execute returns either an array or { rows }. */
function countRows(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown[] }).rows)
  ) {
    return (result as { rows: unknown[] }).rows.length;
  }
  return 0;
}

/** Hook for operator-action sites (reply sent, state change) to
 *  reset cadence immediately without waiting for the next cron tick. */
export async function clearCadenceOnAction(threadId: string): Promise<void> {
  await db
    .update(emailThreads)
    .set({
      followUpStage: 0,
      followUpNextDueAt: null,
    })
    .where(eq(emailThreads.id, threadId));
}
