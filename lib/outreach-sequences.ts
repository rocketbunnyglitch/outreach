import "server-only";

/**
 * Cadence engine.
 *
 * - enrollOnSend(): called from send-outreach + send-worker after a
 *   successful cold send. Creates an outreach_sequence_state row with
 *   next_step_number=2 and next_step_due_at=now+delay_of_step_2.
 *
 * - advanceAfterFollowup(): called after the worker fires a follow-up.
 *   Bumps last_step_sent and computes the next due_at, or marks the
 *   sequence completed if no more steps.
 *
 * - stopSequence(): writes stopped_at + stopped_reason. Called by reply
 *   poller, bounce handler, unsubscribe endpoint, decline action, or
 *   manual stop UI.
 *
 * Single active sequence per (venue, brand) — see the partial unique
 * index in migration 0009. Trying to enroll again while one is active
 * is a no-op (returns the existing row).
 */

import { randomBytes } from "node:crypto";
import { outreachCadenceSteps, outreachSequenceState, venues } from "@/db/schema";
import { db, withAuditContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, asc, eq, isNull } from "drizzle-orm";

export interface EnrollOpts {
  venueId: string;
  outreachBrandId: string;
  staffMemberId: string;
  staffOutreachEmailId: string;
  recipientEmail: string;
}

/**
 * Called after a successful step-1 (cold) send. If there's already an
 * active sequence, no-op (idempotent for the cascade case where the
 * same cold send might be retried).
 *
 * Returns the sequence state row or null if no cadence exists for the
 * brand (sequences are optional — brand at Phase 1 with no defined
 * cadence sends one-off, no follow-up scheduled).
 */
export async function enrollOnSend(opts: EnrollOpts): Promise<{
  sequenceStateId: string;
  nextStepDueAt: Date | null;
  unsubscribeToken: string;
} | null> {
  // Is there an active sequence already?
  const existing = await db
    .select({
      id: outreachSequenceState.id,
      nextStepDueAt: outreachSequenceState.nextStepDueAt,
      unsubscribeToken: outreachSequenceState.unsubscribeToken,
    })
    .from(outreachSequenceState)
    .where(
      and(
        eq(outreachSequenceState.venueId, opts.venueId),
        eq(outreachSequenceState.outreachBrandId, opts.outreachBrandId),
        isNull(outreachSequenceState.stoppedAt),
      ),
    )
    .limit(1)
    .then((r) => r[0]);

  if (existing) {
    return {
      sequenceStateId: existing.id,
      nextStepDueAt: existing.nextStepDueAt,
      unsubscribeToken: existing.unsubscribeToken,
    };
  }

  // Look up Step 2 from the cadence
  const step2 = await db
    .select()
    .from(outreachCadenceSteps)
    .where(
      and(
        eq(outreachCadenceSteps.outreachBrandId, opts.outreachBrandId),
        eq(outreachCadenceSteps.stepNumber, 2),
      ),
    )
    .limit(1)
    .then((r) => r[0]);

  // No cadence defined for this brand → no auto follow-up. We still
  // create a sequence_state row so future cadence creation can pick it
  // up, but with next_step_number=null (sequence complete).
  const nextStepNumber = step2 ? 2 : null;
  const nextStepDueAt = step2
    ? computeNextDueAt(new Date(), step2.delayDays, step2.sendHour)
    : null;

  const unsubscribeToken = generateUnsubscribeToken();

  try {
    const newRow = await withAuditContext(opts.staffMemberId, async (tx) => {
      const [row] = await tx
        .insert(outreachSequenceState)
        .values({
          venueId: opts.venueId,
          outreachBrandId: opts.outreachBrandId,
          staffMemberId: opts.staffMemberId,
          staffOutreachEmailId: opts.staffOutreachEmailId,
          recipientEmail: opts.recipientEmail,
          lastStepSent: 1,
          lastStepSentAt: new Date(),
          nextStepNumber,
          nextStepDueAt,
          unsubscribeToken,
          stoppedAt: nextStepNumber ? null : new Date(),
          stoppedReason: nextStepNumber ? null : "completed",
          createdBy: opts.staffMemberId,
          updatedBy: opts.staffMemberId,
        })
        .returning({ id: outreachSequenceState.id });
      return row?.id ?? null;
    });

    if (!newRow) return null;
    return {
      sequenceStateId: newRow,
      nextStepDueAt,
      unsubscribeToken,
    };
  } catch (err) {
    // Race condition: another concurrent send already enrolled. Re-fetch.
    logger.warn({ err, venueId: opts.venueId }, "enrollOnSend race — re-fetching");
    const after = await db
      .select({
        id: outreachSequenceState.id,
        nextStepDueAt: outreachSequenceState.nextStepDueAt,
        unsubscribeToken: outreachSequenceState.unsubscribeToken,
      })
      .from(outreachSequenceState)
      .where(
        and(
          eq(outreachSequenceState.venueId, opts.venueId),
          eq(outreachSequenceState.outreachBrandId, opts.outreachBrandId),
          isNull(outreachSequenceState.stoppedAt),
        ),
      )
      .limit(1)
      .then((r) => r[0]);
    return after
      ? {
          sequenceStateId: after.id,
          nextStepDueAt: after.nextStepDueAt,
          unsubscribeToken: after.unsubscribeToken,
        }
      : null;
  }
}

/**
 * Called after a follow-up send fires successfully. Looks up the next
 * step in the cadence; advances or completes.
 */
export async function advanceAfterFollowup(opts: {
  sequenceStateId: string;
  staffMemberId: string;
  stepJustSent: number;
}): Promise<void> {
  const next = await db
    .select()
    .from(outreachCadenceSteps)
    .innerJoin(
      outreachSequenceState,
      eq(outreachSequenceState.outreachBrandId, outreachCadenceSteps.outreachBrandId),
    )
    .where(
      and(
        eq(outreachSequenceState.id, opts.sequenceStateId),
        eq(outreachCadenceSteps.stepNumber, opts.stepJustSent + 1),
      ),
    )
    .limit(1)
    .then((r) => r[0]);

  await withAuditContext(opts.staffMemberId, async (tx) => {
    if (!next) {
      // Sequence complete
      await tx
        .update(outreachSequenceState)
        .set({
          lastStepSent: opts.stepJustSent,
          lastStepSentAt: new Date(),
          nextStepNumber: null,
          nextStepDueAt: null,
          stoppedAt: new Date(),
          stoppedReason: "completed",
          updatedBy: opts.staffMemberId,
        })
        .where(eq(outreachSequenceState.id, opts.sequenceStateId));
      return;
    }
    const nextDueAt = computeNextDueAt(
      new Date(),
      next.outreach_cadence_steps.delayDays,
      next.outreach_cadence_steps.sendHour,
    );
    await tx
      .update(outreachSequenceState)
      .set({
        lastStepSent: opts.stepJustSent,
        lastStepSentAt: new Date(),
        nextStepNumber: next.outreach_cadence_steps.stepNumber,
        nextStepDueAt: nextDueAt,
        updatedBy: opts.staffMemberId,
      })
      .where(eq(outreachSequenceState.id, opts.sequenceStateId));
  });
}

/**
 * Stop a sequence with a reason. Idempotent — calling on an already-
 * stopped sequence updates the reason if it was 'completed'.
 */
export async function stopSequence(opts: {
  sequenceStateId: string;
  reason: "replied" | "bounced" | "unsubscribed" | "declined" | "manual" | "completed";
  staffMemberId?: string;
}): Promise<void> {
  await withAuditContext(
    opts.staffMemberId ?? "00000000-0000-0000-0000-000000000000",
    async (tx) => {
      await tx
        .update(outreachSequenceState)
        .set({
          stoppedAt: new Date(),
          stoppedReason: opts.reason,
          nextStepNumber: null,
          nextStepDueAt: null,
          updatedBy: opts.staffMemberId,
        })
        .where(eq(outreachSequenceState.id, opts.sequenceStateId));
    },
  );
}

/**
 * Helper for the inbound-reply poller / bounce handler / unsubscribe
 * endpoint: stop all active sequences for a (venue, brand) pair.
 */
export async function stopSequencesForVenue(opts: {
  venueId: string;
  outreachBrandId?: string;
  reason: "replied" | "bounced" | "unsubscribed" | "declined" | "manual";
}): Promise<number> {
  const rows = await db
    .select({ id: outreachSequenceState.id })
    .from(outreachSequenceState)
    .where(
      and(
        eq(outreachSequenceState.venueId, opts.venueId),
        opts.outreachBrandId
          ? eq(outreachSequenceState.outreachBrandId, opts.outreachBrandId)
          : isNull(outreachSequenceState.stoppedAt),
        isNull(outreachSequenceState.stoppedAt),
      ),
    );
  for (const r of rows) {
    await stopSequence({ sequenceStateId: r.id, reason: opts.reason });
  }
  return rows.length;
}

/**
 * Mark a venue as globally unsubscribed (via one-click link). Also stops
 * every active sequence for that venue.
 */
export async function markUnsubscribed(token: string): Promise<{ venueId: string } | null> {
  const seq = await db
    .select({
      id: outreachSequenceState.id,
      venueId: outreachSequenceState.venueId,
    })
    .from(outreachSequenceState)
    .where(eq(outreachSequenceState.unsubscribeToken, token))
    .limit(1)
    .then((r) => r[0]);
  if (!seq) return null;

  await db
    .update(venues)
    .set({
      unsubscribedAt: new Date(),
      doNotContact: true,
      doNotContactReason: "unsubscribed via one-click link",
    })
    .where(eq(venues.id, seq.venueId));

  await stopSequencesForVenue({ venueId: seq.venueId, reason: "unsubscribed" });
  return { venueId: seq.venueId };
}

/**
 * Look up due follow-ups for the send worker. Sorted by next_step_due_at
 * ascending so the worker fires oldest first.
 */
export async function loadDueFollowups(opts: { limit: number; now?: Date }) {
  const now = opts.now ?? new Date();
  return db
    .select()
    .from(outreachSequenceState)
    .where(
      and(
        isNull(outreachSequenceState.stoppedAt),
        // nextStepDueAt <= now AND nextStepNumber IS NOT NULL
      ),
    )
    .orderBy(asc(outreachSequenceState.nextStepDueAt))
    .limit(opts.limit)
    .then((rows) =>
      rows.filter((r) => r.nextStepNumber !== null && r.nextStepDueAt && r.nextStepDueAt <= now),
    );
}

// ---------- helpers ----------

function computeNextDueAt(from: Date, delayDays: number, sendHour: number | null): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + delayDays);
  if (sendHour !== null) {
    // Snap to the given hour (local time, NOT UTC). The send worker
    // re-checks business-hours in the inbox's TZ so this is just a
    // hint for "send around 10am instead of whenever the delay lands".
    next.setHours(sendHour, 0, 0, 0);
  }
  // Skip weekends — bump to Monday if it falls on Sat/Sun
  const dow = next.getDay();
  if (dow === 0) next.setDate(next.getDate() + 1); // Sun → Mon
  if (dow === 6) next.setDate(next.getDate() + 2); // Sat → Mon
  return next;
}

function generateUnsubscribeToken(): string {
  return randomBytes(24).toString("base64url");
}
