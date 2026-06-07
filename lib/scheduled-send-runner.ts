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

import { type EmailDraftAttachment, emailDrafts, users } from "@/db/schema";
import { composeAndSendImpl } from "@/lib/compose-send-impl";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { shouldBlockLifecycleSend } from "@/lib/relationship-send-gate";
import { cronMaySendDraft } from "@/lib/send-mode-gate";
import { and, eq, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";

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
        // P0-1 SEND-SAFETY GATE. "Engine drafts. Humans send." The cron may
        // ONLY dispatch a draft a human approved (send_mode=operator_scheduled
        // with approved_at set) OR an explicitly auto-allowed NON-venue
        // transactional message (host/internal/system). Engine-generated
        // drafts default to send_mode=review_required and are NEVER auto-sent;
        // they surface in the operator worklist for review.
        or(
          and(eq(emailDrafts.sendMode, "operator_scheduled"), isNotNull(emailDrafts.approvedAt)),
          and(
            eq(emailDrafts.sendMode, "auto_allowed"),
            inArray(emailDrafts.recipientType, ["host", "internal", "system"]),
          ),
        ),
      ),
    )
    .limit(100);

  let sent = 0;
  let failed = 0;

  for (const { draft, owner } of candidates) {
    // P0-1 defense-in-depth: re-check the send-mode boundary in code (the SQL
    // filter above already excludes these, but this guarantees it + is unit-
    // tested in lib/send-mode-gate.test.ts). review_required / unapproved drafts
    // are never dispatched.
    if (!cronMaySendDraft(draft, now)) {
      logger.warn(
        { draftId: draft.id, sendMode: draft.sendMode },
        "scheduled send: draft not cron-sendable; skipping (defense-in-depth)",
      );
      continue;
    }

    // T17 [ReferenceDoc 7.15.2]: never auto-send a relationship-gated lifecycle
    // template to a venue x outreach-brand pair flagged 'bad'. Re-check at
    // dispatch time (the flag may have been set after the draft was scheduled).
    // Stop it retrying every tick by stamping sent_at WITHOUT a sent_thread_id:
    // the runner filters sent_at IS NULL, so this drops it from all future
    // ticks; the null sent_thread_id marks it blocked-not-delivered (a real
    // send always sets a thread id), keeping the audit trail intact.
    if (await shouldBlockLifecycleSend({ draft })) {
      await db
        .update(emailDrafts)
        .set({ sentAt: new Date(), sentThreadId: null, updatedAt: new Date() })
        .where(eq(emailDrafts.id, draft.id));
      logger.info(
        { draftId: draft.id, owner: owner.id },
        "scheduled send blocked: T17 to a bad venue x brand pair; cancelled (will not retry)",
      );
      failed += 1;
      continue;
    }

    if (!draft.connectedAccountId) {
      logger.info(
        { draftId: draft.id, owner: owner.id },
        "scheduled draft has no fromAccountId; skipping",
      );
      failed += 1;
      continue;
    }
    const toAddresses = (draft.toAddresses ?? []).filter((s) => s && s.trim().length > 0);
    if (toAddresses.length === 0) {
      logger.info(
        { draftId: draft.id, owner: owner.id },
        "scheduled draft has no recipient; skipping",
      );
      failed += 1;
      continue;
    }

    // Atomically CLAIM the draft before sending. UPDATE...WHERE sent_at IS NULL
    // is atomic, so two overlapping cron ticks (or a tick racing a manual send)
    // can't both dispatch the same draft -- exactly one flips it. If we don't
    // win the claim, someone else already took it -> skip. Released below if the
    // send is blocked BEFORE Gmail accepted it.
    const claim = await db
      .update(emailDrafts)
      .set({ sentAt: now, updatedAt: now })
      .where(and(eq(emailDrafts.id, draft.id), isNull(emailDrafts.sentAt)))
      .returning({ id: emailDrafts.id });
    if (claim.length === 0) continue;

    // Construct the FormData composeAndSend expects. This MUST mirror
    // the interactive path in app/(admin)/_actions/email-drafts.ts
    // (sendDraftAsUser) field-for-field. Previously the cron forwarded
    // only the first To recipient and dropped cc/bcc, attachments,
    // reply/thread context, quoted HTML, pending labels, and the
    // template id -- so scheduled replies lost threading + attachments
    // and were misclassified as cold. Keep these two builders in sync.
    const fd = new FormData();
    fd.set("fromAccountId", draft.connectedAccountId);
    // Pass ALL To recipients as a comma-separated list -- composeAndSendImpl
    // parses CSV. Forwarding only the first recipient silently dropped
    // any additional To addresses on the draft.
    fd.set("to", toAddresses.join(","));
    if (draft.ccAddresses && draft.ccAddresses.length > 0) {
      fd.set("cc", draft.ccAddresses.join(","));
    }
    if (draft.bccAddresses && draft.bccAddresses.length > 0) {
      fd.set("bcc", draft.bccAddresses.join(","));
    }
    fd.set("subject", draft.subject);
    fd.set("body", draft.bodyText);
    // Concatenate the operator's edited bodyHtml with the read-only
    // quoted original (if any) so the recipient receives the full
    // thread. Mirrors sendDraftAsUser.
    if (draft.bodyHtml || draft.quotedHtml) {
      const bodyPart = draft.bodyHtml ?? "";
      const quotePart = draft.quotedHtml ? `<br><br>${draft.quotedHtml}` : "";
      fd.set("bodyHtml", bodyPart + quotePart);
    }
    if (draft.venueId) fd.set("venueId", draft.venueId);
    // Send-intent signals (P0): forward the draft's touch code + recipient
    // type so a cron-dispatched lifecycle email (e.g. T14/T15) is classified
    // operational -- never cap-blocked, never counted against the cold budget,
    // never seeded as cold cadence. (cityCampaignId is intentionally NOT
    // forwarded here so queued cold-send cadence behavior is unchanged; the
    // intent classifier still works off touch_type / template_code.)
    if (draft.touchType) fd.set("touchType", draft.touchType);
    if (draft.recipientType) fd.set("recipientType", draft.recipientType);
    if (draft.venueEventId) fd.set("venueEventId", draft.venueEventId);
    // Reply/forward context -- composeAndSendImpl branches on these to
    // attach the new message to the existing Gmail thread (keeps
    // threading + ensures the send classifies as warm) instead of
    // opening a fresh thread.
    if (draft.replyToThreadId) fd.set("replyToThreadId", draft.replyToThreadId);
    if (draft.replyToMessageId) fd.set("replyToMessageId", draft.replyToMessageId);
    if (draft.mode) fd.set("composeMode", draft.mode);
    // Attachments -- forward only entries with a storage_key (memory-only
    // chips can't be resolved server-side); passed as JSON for
    // compose-send-impl to fetch bytes for the multipart build.
    const attachmentsToSend =
      (draft.attachments as EmailDraftAttachment[] | null)?.filter((a) => a.storage_key) ?? [];
    if (attachmentsToSend.length > 0) {
      fd.set("attachments", JSON.stringify(attachmentsToSend));
    }
    // Pending labels -- applied to the resulting thread after the Gmail
    // send completes (handled inside compose-send-impl).
    const pendingLabelIds = (draft.pendingLabelIds ?? []) as string[];
    if (pendingLabelIds.length > 0) {
      fd.set("labelIds", pendingLabelIds.join(","));
    }
    // Template attribution -- recorded on email_send_events for
    // per-template analytics. Null when composed freeform.
    if (draft.templateId) fd.set("templateId", draft.templateId);
    // Scheduled sends never bypass the cap -- if the owner's daily
    // window is full, the draft retries on the next tick. (No
    // bypassCap / ackDuplicates fields: the cron can't acknowledge
    // interactive warnings, so a flagged draft simply retries.)

    try {
      const result = await composeAndSendImpl(owner, fd);
      if (result.ok) {
        // Already claimed (sent_at set above); just link the thread.
        await db
          .update(emailDrafts)
          .set({ sentThreadId: result.threadId, updatedAt: new Date() })
          .where(eq(emailDrafts.id, draft.id));
        sent += 1;
      } else {
        // Release the claim so the draft retries -- UNLESS Gmail already
        // accepted the message (gmailSent), in which case releasing would
        // double-send. A gmail-sent-but-not-saved draft stays claimed (sent_at
        // set, no thread id) = the blocked-not-delivered marker (like T17).
        if (!result.gmailSent) {
          await db
            .update(emailDrafts)
            .set({ sentAt: null, updatedAt: new Date() })
            .where(eq(emailDrafts.id, draft.id));
        }
        failed += 1;
        logger.warn(
          { draftId: draft.id, owner: owner.id, error: result.error, gmailSent: result.gmailSent },
          "scheduled send failed (will retry next tick)",
        );
      }
    } catch (err) {
      // A throw from composeAndSendImpl is pre-Gmail (it catches its own
      // post-send DB errors and returns ok:false instead of throwing), so it's
      // safe to release the claim for a retry.
      await db
        .update(emailDrafts)
        .set({ sentAt: null, updatedAt: new Date() })
        .where(eq(emailDrafts.id, draft.id));
      failed += 1;
      logger.error({ err, draftId: draft.id }, "scheduled send threw unexpectedly");
    }
  }

  return { attempted: candidates.length, sent, failed };
}
