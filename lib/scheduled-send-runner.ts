import "server-only";

/**
 * Scheduled-send runner. Cron entry point that dispatches every
 * draft whose scheduled_for has elapsed AND that hasn't been sent.
 *
 * Each draft is routed through the same composeAndSend pipeline the
 * UI uses (send-cap, DNC, suppression, duplicate detection,
 * Gmail-mirror, audit). The runner constructs a server-verified
 * staff context from each draft's owner_user_id and calls
 * COMPOSE_AND_SEND_INTERNAL.impl — see compose-and-send.ts for why
 * that indirection exists.
 *
 * Idempotency:
 *   - Cap at 100 drafts per tick. Anything beyond falls to the
 *     next tick.
 *   - sent_at IS NULL filter ensures a draft is never sent twice
 *     even if the cron tick overlaps.
 *   - Per-user cap is enforced inside composeAndSend so a single
 *     user can't queue 100 scheduled drafts that all fire at once
 *     to bypass their daily quota.
 *
 * Failure handling:
 *   - One failed send doesn't abort the batch
 *   - Failed drafts stay with sent_at NULL — next tick retries
 *   - The retry is bounded by the user's send cap (no runaway)
 */

import { emailDrafts, users } from "@/db/schema";
import { composeAndSendImpl } from "@/lib/compose-send-impl";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";

export interface ScheduledSendResult {
  attempted: number;
  sent: number;
  failed: number;
}

export async function runScheduledSends(): Promise<ScheduledSendResult> {
  const now = new Date();

  // Pull dispatch candidates joined to their owner — we need the
  // staff context (id, teamId, role, displayName, primaryEmail) to
  // feed into _composeAndSendImpl.
  const candidates = await db
    .select({
      draft: emailDrafts,
      owner: {
        id: users.id,
        teamId: users.teamId,
        role: users.role,
        displayName: users.displayName,
        primaryEmail: users.primaryEmail,
      },
    })
    .from(emailDrafts)
    .innerJoin(users, eq(users.id, emailDrafts.ownerUserId))
    .where(
      and(
        isNull(emailDrafts.sentAt),
        isNotNull(emailDrafts.scheduledFor),
        lte(emailDrafts.scheduledFor, now),
      ),
    )
    .limit(100);

  let sent = 0;
  let failed = 0;

  for (const { draft, owner } of candidates) {
    if (!draft.connectedAccountId) {
      logger.info(
        { draftId: draft.id, owner: owner.id },
        "scheduled draft has no fromAccountId; skipping",
      );
      failed += 1;
      continue;
    }
    const to = (draft.toAddresses ?? [])[0];
    if (!to) {
      logger.info(
        { draftId: draft.id, owner: owner.id },
        "scheduled draft has no recipient; skipping",
      );
      failed += 1;
      continue;
    }

    // Construct the FormData composeAndSend expects.
    const fd = new FormData();
    fd.set("fromAccountId", draft.connectedAccountId);
    fd.set("to", to);
    if (draft.ccAddresses && draft.ccAddresses.length > 0) {
      fd.set("cc", draft.ccAddresses.join(","));
    }
    if (draft.bccAddresses && draft.bccAddresses.length > 0) {
      fd.set("bcc", draft.bccAddresses.join(","));
    }
    fd.set("subject", draft.subject);
    fd.set("body", draft.bodyText);
    if (draft.bodyHtml) fd.set("bodyHtml", draft.bodyHtml);
    if (draft.venueId) fd.set("venueId", draft.venueId);
    // Scheduled sends never bypass the cap — if the owner's daily
    // window is full, the draft retries on the next tick.

    try {
      const result = await composeAndSendImpl(owner, fd);
      if (result.ok) {
        // Mark the draft as sent + link the thread.
        await db
          .update(emailDrafts)
          .set({ sentAt: new Date(), sentThreadId: result.threadId, updatedAt: new Date() })
          .where(eq(emailDrafts.id, draft.id));
        sent += 1;
      } else {
        failed += 1;
        logger.warn(
          { draftId: draft.id, owner: owner.id, error: result.error },
          "scheduled send failed (will retry next tick)",
        );
      }
    } catch (err) {
      failed += 1;
      logger.error({ err, draftId: draft.id }, "scheduled send threw unexpectedly");
    }
  }

  return { attempted: candidates.length, sent, failed };
}
