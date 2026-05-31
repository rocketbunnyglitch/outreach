import "server-only";

/**
 * AI cold-outreach status auto-update — Tier A #6 of the Haiku
 * ROI sprint.
 *
 * Cost: ~free. Piggybacks on the existing ai-classify pass that
 * already runs on every inbound (Phase A.1). No extra model call;
 * we just translate the classification it ALREADY produced into a
 * cold_outreach_status update.
 *
 * Mapping (classifier → cold status):
 *
 *   interested          → interested
 *   warm                → interested
 *   confirmed           → interested        (operator promotes to
 *                                            an actual booking via
 *                                            the existing promote
 *                                            flow; we don't try to
 *                                            invent "booked" here)
 *   callback_requested  → called            (the venue asked us to
 *                                            call them — treating
 *                                            as "we have a phone
 *                                            thread now" is the
 *                                            operator's mental
 *                                            model)
 *   decline             → declined
 *   unsubscribe         → do_not_contact
 *   auto_reply          → (no update — vacation responder etc.)
 *   spam                → (no update — leave the row as-is so the
 *                          operator can decide)
 *   question            → (no update — questions don't change
 *                          status; the operator still needs to
 *                          reply and decide)
 *
 * Guardrails:
 *   - AI_AUTO_STATUS_ENABLED env flag (kill switch)
 *   - Never DOWNGRADES status: if the operator manually set the
 *     cold entry to "interested" and a later auto-reply comes in,
 *     we don't move it back. The mapping below ONLY applies when
 *     the entry's current status is "less progressed" than the
 *     suggested target.
 *   - Confidence threshold: 0.7. Below that, leave the status as
 *     is — the classification is too uncertain.
 *   - Only one update per (entry, classification) — if the same
 *     classification arrives twice, the second is a no-op (status
 *     would already be the target).
 *   - Logged with classification + previous status + new status
 *     so a backfill query can audit "what did AI change."
 *   - NEVER throws.
 */

import { coldOutreachEntries, emailThreads } from "@/db/schema";
import { isAiFeatureEnabled } from "@/lib/ai-guardrails";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, eq } from "drizzle-orm";

/** Cold-outreach status values, ordered by "progression" — higher
 *  index means a more advanced/decided state. Used by the
 *  no-downgrade rule. */
const PROGRESSION_ORDER: Record<string, number> = {
  not_contacted: 0,
  email_sent: 1,
  voicemail: 1,
  no_answer: 1,
  follow_up_due: 2,
  called: 3,
  interested: 4,
  unreachable: 5,
  declined: 6,
  bad_email: 6,
  wrong_number: 6,
  do_not_contact: 7,
};

/** Confidence below this leaves the status alone. */
const MIN_CONFIDENCE = 0.7;

/** Classification → target cold-outreach status. Null = no change. */
function mapClassificationToStatus(classification: string | null): string | null {
  switch (classification) {
    case "interested":
    case "warm":
    case "confirmed":
      return "interested";
    case "callback_requested":
      return "called";
    case "decline":
      return "declined";
    case "unsubscribe":
      return "do_not_contact";
    case "auto_reply":
    case "spam":
    case "question":
    case "unclassified":
    case null:
      return null;
    default:
      return null;
  }
}

export interface AutoStatusContext {
  threadId: string;
  classification: string;
  /** 0..1 from the classifier. */
  confidence: number;
}

/**
 * Fire-and-forget wrapper used by ai-classify after it writes the
 * suggested_classification column. Never throws.
 */
export async function syncColdStatusFromClassificationAsync(
  input: AutoStatusContext,
): Promise<void> {
  try {
    await syncColdStatusFromClassification(input);
  } catch (err) {
    logger.error(
      { err, threadId: input.threadId },
      "cold-status auto-update failed (fire-and-forget)",
    );
  }
}

export async function syncColdStatusFromClassification(input: AutoStatusContext): Promise<void> {
  if (!isAiFeatureEnabled("auto_status")) return;
  if (input.confidence < MIN_CONFIDENCE) return;

  const target = mapClassificationToStatus(input.classification);
  if (!target) return;

  // Resolve the thread → venueId + cityCampaignId so we can find
  // the matching cold_outreach_entries row.
  const [thread] = await db
    .select({
      id: emailThreads.id,
      venueId: emailThreads.venueId,
      cityCampaignId: emailThreads.cityCampaignId,
    })
    .from(emailThreads)
    .where(eq(emailThreads.id, input.threadId))
    .limit(1);
  if (!thread || !thread.venueId) return;

  // No campaign attached → can't update any cold entry. The thread
  // might still get attributed later, but auto-status only fires on
  // attached threads (the classifier itself ran successfully so the
  // venue is at least known).
  if (!thread.cityCampaignId) {
    // Try to find ANY cold entry for this venue across active
    // city_campaigns the venue belongs to. If exactly one, update
    // it — otherwise skip (we'd be guessing).
    const candidates = await db
      .select({
        id: coldOutreachEntries.id,
        cityCampaignId: coldOutreachEntries.cityCampaignId,
        status: coldOutreachEntries.status,
      })
      .from(coldOutreachEntries)
      .where(eq(coldOutreachEntries.venueId, thread.venueId))
      .limit(2);
    if (candidates.length !== 1) return;
    const entry = candidates[0];
    if (!entry) return;
    await applyStatusUpdate({
      entryId: entry.id,
      current: entry.status,
      target,
      classification: input.classification,
      confidence: input.confidence,
    });
    return;
  }

  const [entry] = await db
    .select({
      id: coldOutreachEntries.id,
      status: coldOutreachEntries.status,
    })
    .from(coldOutreachEntries)
    .where(
      and(
        eq(coldOutreachEntries.cityCampaignId, thread.cityCampaignId),
        eq(coldOutreachEntries.venueId, thread.venueId),
      ),
    )
    .limit(1);
  if (!entry) return;

  await applyStatusUpdate({
    entryId: entry.id,
    current: entry.status,
    target,
    classification: input.classification,
    confidence: input.confidence,
  });
}

async function applyStatusUpdate(opts: {
  entryId: string;
  current: string;
  target: string;
  classification: string;
  confidence: number;
}): Promise<void> {
  if (opts.current === opts.target) return; // No-op

  // No-downgrade: only move "forward" in the progression order.
  // Operator-set states like do_not_contact / declined / interested
  // are sticky against later auto-replies.
  const currentRank = PROGRESSION_ORDER[opts.current] ?? -1;
  const targetRank = PROGRESSION_ORDER[opts.target] ?? -1;
  if (targetRank <= currentRank) {
    logger.debug(
      {
        entryId: opts.entryId,
        from: opts.current,
        to: opts.target,
        classification: opts.classification,
      },
      "cold-status auto-update skipped (no downgrade)",
    );
    return;
  }

  await db
    .update(coldOutreachEntries)
    .set({
      status: opts.target as
        | "not_contacted"
        | "email_sent"
        | "follow_up_due"
        | "called"
        | "voicemail"
        | "no_answer"
        | "interested"
        | "declined"
        | "bad_email"
        | "wrong_number"
        | "do_not_contact"
        | "unreachable",
      lastTouchAt: new Date(),
    })
    .where(eq(coldOutreachEntries.id, opts.entryId));

  logger.info(
    {
      entryId: opts.entryId,
      from: opts.current,
      to: opts.target,
      classification: opts.classification,
      confidence: opts.confidence,
    },
    "cold-status auto-update applied",
  );
}
