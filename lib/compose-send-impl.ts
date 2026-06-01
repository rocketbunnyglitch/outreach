import "server-only";

/**
 * Compose-and-send implementation extracted from the action file.
 *
 * Lives in lib/ (NOT under app/(admin)/_actions/) so it's NOT a
 * "use server" module — Next 15 forbids non-async-function exports
 * from "use server" files, and the scheduled-send cron needs a
 * non-action handle to call the same pipeline with an explicit
 * staff context.
 *
 * Two callers:
 *   - composeAndSend (the public server action) — wraps this with
 *     requireStaff so client-side requests are auth-gated
 *   - lib/scheduled-send-runner.ts — passes each draft's
 *     owner_user_id (verified via server-side join) and delegates
 *
 * No client code should import from here directly. Audit script
 * (scripts/audit-server-only-imports.sh) catches accidental client
 * imports via the "server-only" sentinel.
 */

import { connectedAccounts, emailMessages, emailThreads } from "@/db/schema";
import { fetchAttachmentBytes, isValidStorageKey } from "@/lib/attachment-storage";
import { db } from "@/lib/db";
import { type GmailAttachment, sendGmailMessage } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { preflightSend, recordSendEvent } from "@/lib/send-cap";
import { describeBlock, runSendSafety } from "@/lib/send-safety";
import { applyLabelToThread } from "@/lib/team-labels";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import type { ComposeResult } from "@/app/(admin)/_actions/compose-and-send";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function composeAndSendImpl(
  staff: {
    id: string;
    teamId: string;
    role: string;
    displayName: string | null;
    primaryEmail: string;
  },
  formData: FormData,
): Promise<ComposeResult> {
  const fromAccountId = String(formData.get("fromAccountId") ?? "");
  const to = String(formData.get("to") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  const venueIdRaw = String(formData.get("venueId") ?? "").trim();
  const venueId = venueIdRaw && UUID_RE.test(venueIdRaw) ? venueIdRaw : null;
  // Template attribution (Phase C.1) — recorded on the send-event
  // for per-template analytics. Validated UUID-only; bad input
  // silently drops to null since the wrong value would just point
  // at a missing FK and the send-event insert would fail with a
  // 23503. Better to under-attribute than break the send.
  const templateIdRaw = String(formData.get("templateId") ?? "").trim();
  const templateId = templateIdRaw && UUID_RE.test(templateIdRaw) ? templateIdRaw : null;
  // Optional comma-separated list of team_label ids to apply to the
  // new thread after send. Filtered to valid UUIDs; unknown ids are
  // dropped silently (label may have been deleted between modal open
  // and submit).
  const labelIdsRaw = String(formData.get("labelIds") ?? "");
  const labelIds = labelIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));

  // Reply / forward context. When replyToThreadId is set, the send
  // pipeline:
  //   - Looks up the thread's gmail_thread_id + (optional) anchor
  //     message's gmail_message_id
  //   - Calls sendGmailMessage with threadId + replyToMessageId so
  //     Gmail nests the new message under the original thread on the
  //     venue side AND adds In-Reply-To/References headers
  //   - Skips creating a new email_threads row (the existing thread
  //     gets a new email_messages row + lastMessageAt bump)
  //
  // composeMode lives on email_drafts.mode for the operator's UI
  // affordances + analytics — the send pipeline itself branches
  // purely on the presence of replyToThreadId.
  const replyToThreadIdRaw = String(formData.get("replyToThreadId") ?? "").trim();
  const replyToThreadId =
    replyToThreadIdRaw && UUID_RE.test(replyToThreadIdRaw) ? replyToThreadIdRaw : null;
  const replyToMessageIdRaw = String(formData.get("replyToMessageId") ?? "").trim();
  const replyToMessageId =
    replyToMessageIdRaw && UUID_RE.test(replyToMessageIdRaw) ? replyToMessageIdRaw : null;

  // Attachments — sendDraftAsUser packs the draft's attachments JSONB
  // (filtered to those with storage_key) as JSON. We fetch the bytes
  // from object storage right before send so a scheduled draft picks
  // up the bytes at dispatch time rather than at autosave.
  const attachmentsRaw = String(formData.get("attachments") ?? "");
  let attachmentRefs: Array<{
    name: string;
    mime: string;
    storage_key?: string;
  }> = [];
  if (attachmentsRaw) {
    try {
      const parsed = JSON.parse(attachmentsRaw);
      if (Array.isArray(parsed)) {
        attachmentRefs = parsed
          .filter(
            (a): a is { name: string; mime: string; storage_key: string } =>
              typeof a === "object" &&
              a !== null &&
              typeof a.name === "string" &&
              typeof a.mime === "string" &&
              typeof a.storage_key === "string" &&
              isValidStorageKey(a.storage_key, staff.teamId),
          )
          .slice(0, 10); // Gmail's hard limit is 25MB total; cap at 10 files defensively
      }
    } catch {
      // Ignore malformed attachments payload — silent drop is safer
      // than blocking the send entirely on a parse error.
    }
  }

  if (!UUID_RE.test(fromAccountId)) return { ok: false, error: "Pick a From inbox." };
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { ok: false, error: "Enter a valid To address." };
  }
  if (!subject) return { ok: false, error: "Subject is required." };
  if (!body.trim()) return { ok: false, error: "Message body is empty." };

  // Verify the From account is on the team + sendable.
  const sender = await db
    .select({
      id: connectedAccounts.id,
      email: connectedAccounts.emailAddress,
      token: connectedAccounts.gmailOauthRefreshToken,
      status: connectedAccounts.status,
      teamId: connectedAccounts.teamId,
    })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.id, fromAccountId), eq(connectedAccounts.teamId, staff.teamId)))
    .limit(1);
  const inbox = sender[0];
  if (!inbox) return { ok: false, error: "That inbox isn't on your team." };
  if (inbox.status === "disconnected" || !inbox.token) {
    return {
      ok: false,
      error: "That inbox is disconnected. Reconnect it in Settings then try again.",
    };
  }

  // Send-safety: suppression + DNC are HARD blocks (no admin
  // override). Duplicate-outreach is a warning the operator must
  // explicitly acknowledge via the dismissDuplicateWarning form
  // field. Compose is always for a NEW thread, so we don't pass
  // excludeThreadId.
  const safety = await runSendSafety({
    teamId: staff.teamId,
    to,
    venueId,
  });
  if (!safety.ok) {
    return {
      ok: false,
      error: describeBlock(safety.block),
      safetyBlock: safety.block,
    };
  }
  // Warnings present + operator hasn't acknowledged → surface them
  // so the modal can render the confirm step.
  const acknowledgedDuplicates = String(formData.get("ackDuplicates") ?? "") === "1";
  if (safety.warnings.length > 0 && !acknowledgedDuplicates) {
    return {
      ok: false,
      error: `Possible duplicate outreach (${safety.warnings.length} open thread${safety.warnings.length === 1 ? "" : "s"} already to this address).`,
      duplicateWarnings: safety.warnings,
    };
  }

  // Preflight: classify + check the cold-send cap.
  //
  // `replyToThreadId` is the engine thread UUID the operator is
  // replying to (passed by sendDraft from email_drafts.reply_to_thread_id).
  // preflightSend looks at that thread's inbound history to decide
  // cold vs warm: a thread with ≥1 inbound message classifies as
  // warm and does NOT count against the cold-send cap.
  //
  // We pass `replyToThreadId` here even though the existence/team
  // guard runs a few lines below. The thread lookup inside
  // classifySend is read-only and team-agnostic — at worst, a
  // bogus thread id classifies as cold (no inbound found), which
  // is the safe default and is what the bail-on-not-found below
  // would have produced anyway.
  //
  // PRIOR BUG (pre-this-commit): this line passed `threadId: null`
  // unconditionally, so every reply through the popout composer
  // (which routes through this function via sendDraft) classified
  // as a cold send and counted against the per-account 30/day cap.
  // sendThreadReply (the older inline-reply path in inbox/_actions)
  // was always correct; only composeAndSendImpl was broken. Symptom:
  // an account at 30/30 cold sends could not reply to an inbound
  // warm thread without admin bypass.
  const bypassCap = String(formData.get("bypassCap") ?? "") === "1";
  const preflight = await preflightSend({
    connectedAccountId: fromAccountId,
    threadId: replyToThreadId,
  });
  if (!preflight.ok) {
    if (!bypassCap || staff.role !== "admin") {
      return {
        ok: false,
        error: `Daily cold-send cap reached on ${inbox.email} (${preflight.usage.used} / ${preflight.usage.cap}). ${
          staff.role === "admin"
            ? "Click 'Bypass cap' to send anyway."
            : "Try a different inbox, or ask an admin to bypass."
        }`,
        capBlocked: true,
        usage: preflight.usage,
      };
    }
    logger.warn(
      { fromAccountId, userId: staff.id, used: preflight.usage.used, cap: preflight.usage.cap },
      "composeAndSend: admin bypassed cold-send cap",
    );
  }
  const sendCategory = preflight.ok ? preflight.category : preflight.category;
  const capBypassed = !preflight.ok && bypassCap;

  // Build light HTML.
  const htmlBody = body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

  // Resolve the reply context (if any) BEFORE the Gmail send so we
  // can pass through threadId + replyToMessageId. The thread + message
  // must be team-scoped and not deleted.
  let replyThreadGmailId: string | null = null;
  let replyMessageRfc822Id: string | null = null;
  let existingEngineThreadId: string | null = null;
  if (replyToThreadId) {
    const [t] = await db
      .select({
        id: emailThreads.id,
        gmailThreadId: emailThreads.gmailThreadId,
        staffOutreachEmailId: emailThreads.staffOutreachEmailId,
      })
      .from(emailThreads)
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
      .where(and(eq(emailThreads.id, replyToThreadId), eq(connectedAccounts.teamId, staff.teamId)))
      .limit(1);
    if (!t) {
      return { ok: false, error: "Reply thread not found or not on your team." };
    }
    // Wrong-account guard: replying from a DIFFERENT connected
    // account than the one that received the thread will:
    //   1. Start a brand-new Gmail thread on the venue's side
    //      (since Gmail can't link a different sender's draft
    //      onto the original thread)
    //   2. Almost certainly send from the wrong brand/persona
    //      (operator sent the original from jc@halloween.com,
    //      now accidentally replying from jc@stpatrick.com)
    //
    // Hard block by default. Admin can override via bypassCap
    // for edge cases where the brand change is intentional
    // (e.g. transitioning the lead between campaigns). The
    // override message uses the same form field for simplicity
    // since the operator already knows how that pattern works
    // from the cold-cap path.
    const wrongAccount = t.staffOutreachEmailId !== fromAccountId;
    const wrongAccountBypassed = wrongAccount && bypassCap && staff.role === "admin";
    if (wrongAccount && !wrongAccountBypassed) {
      // Look up the right account's email + the chosen account's
      // email so the error message is concrete enough for the
      // operator to fix it themselves.
      const [right, chosen] = await Promise.all([
        db
          .select({ email: connectedAccounts.emailAddress })
          .from(connectedAccounts)
          .where(eq(connectedAccounts.id, t.staffOutreachEmailId))
          .limit(1),
        db
          .select({ email: connectedAccounts.emailAddress })
          .from(connectedAccounts)
          .where(eq(connectedAccounts.id, fromAccountId))
          .limit(1),
      ]);
      const rightEmail = right[0]?.email ?? "(unknown)";
      const chosenEmail = chosen[0]?.email ?? "(unknown)";
      logger.warn(
        { threadId: t.id, threadAccountId: t.staffOutreachEmailId, fromAccountId },
        "composeAndSend: wrong-account reply blocked",
      );
      return {
        ok: false,
        error: `This thread is on ${rightEmail}; you picked ${chosenEmail} to reply from. Replying from a different inbox would start a brand-new Gmail thread on the venue's side and likely send from the wrong brand. ${
          staff.role === "admin"
            ? "Switch From to the right inbox, or check 'Bypass safety' to send from the chosen account anyway."
            : "Switch From to the right inbox, or ask an admin if you need to send from a different account."
        }`,
        wrongAccountBlocked: true,
        threadAccountEmail: rightEmail,
        chosenAccountEmail: chosenEmail,
      };
    }
    if (wrongAccountBypassed) {
      logger.warn(
        {
          threadId: t.id,
          threadAccountId: t.staffOutreachEmailId,
          fromAccountId,
          userId: staff.id,
        },
        "composeAndSend: admin bypassed wrong-account guard",
      );
    }
    replyThreadGmailId = t.gmailThreadId;
    existingEngineThreadId = t.id;
    if (replyToMessageId) {
      const [m] = await db
        .select({ rfc822: emailMessages.rfcMessageId })
        .from(emailMessages)
        .where(and(eq(emailMessages.id, replyToMessageId), eq(emailMessages.threadId, t.id)))
        .limit(1);
      if (m?.rfc822) replyMessageRfc822Id = m.rfc822;
    }
  }

  // Resolve attachment bytes from object storage before send.
  // Failures here block the send — sending a draft that THINKS it
  // has attachments but actually doesn't is worse than failing loud.
  const gmailAttachments: GmailAttachment[] = [];
  for (const ref of attachmentRefs) {
    if (!ref.storage_key) continue;
    const bytes = await fetchAttachmentBytes(ref.storage_key);
    if (!bytes) {
      logger.error(
        { storageKey: ref.storage_key, fromAccountId },
        "composeAndSend: attachment bytes missing",
      );
      return {
        ok: false,
        error: `Couldn't load attachment "${ref.name}" — storage may be misconfigured or the file was deleted.`,
      };
    }
    gmailAttachments.push({ filename: ref.name, mimeType: ref.mime, data: bytes });
  }

  let sent: { id: string; threadId: string };
  try {
    sent = await sendGmailMessage({
      encryptedRefreshToken: inbox.token,
      from: inbox.email,
      to,
      subject,
      htmlBody,
      textBody: body,
      threadId: replyThreadGmailId ?? undefined,
      replyToMessageId: replyMessageRfc822Id ?? undefined,
      attachments: gmailAttachments.length > 0 ? gmailAttachments : undefined,
    });
  } catch (err) {
    logger.error({ err, fromAccountId, to }, "composeAndSend: gmail send failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't send the message.",
    };
  }

  // Record the thread + outbound message so the inbox view picks it
  // up immediately (poll worker would also pick it up on the next
  // cycle, but we don't want to wait).
  //
  // Two paths:
  //   - existingEngineThreadId set (reply/forward): append a new
  //     email_messages row + UPDATE the existing thread's last_*
  //     fields. Skip thread creation.
  //   - new thread: INSERT a new email_threads row (existing path).
  const now = new Date();
  let threadId: string;
  try {
    if (existingEngineThreadId) {
      threadId = existingEngineThreadId;

      // Increment messageCount + bump last_* on the existing thread.
      // State transitions to waiting_on_them (operator just replied —
      // the ball is back in the venue's court). Don't touch
      // assignedStaffId / venueId / brand etc — those persist.
      await db
        .update(emailThreads)
        .set({
          state: "waiting_on_them",
          direction: "mixed",
          messageCount: sql`${emailThreads.messageCount} + 1`,
          lastOutboundAt: now,
          lastSenderName: inbox.email,
          lastMessageAt: now,
          snippet: body.slice(0, 140),
          // Replying clears any stale flag + follow-up cadence —
          // operator just engaged.
          isStale: false,
          staleSince: null,
          staleReason: null,
          followUpStage: 0,
          followUpNextDueAt: null,
          updatedBy: staff.id,
        })
        .where(eq(emailThreads.id, threadId));
    } else {
      const inserted = await db
        .insert(emailThreads)
        .values({
          staffOutreachEmailId: inbox.id,
          gmailThreadId: sent.threadId,
          venueId,
          subject,
          state: "waiting_on_them",
          direction: "outbound",
          classification: "unclassified",
          snippet: body.slice(0, 140),
          messageCount: 1,
          unreadCount: 0,
          lastOutboundAt: now,
          lastSenderName: inbox.email,
          lastMessageAt: now,
          createdBy: staff.id,
          updatedBy: staff.id,
        })
        .returning({ id: emailThreads.id });
      const t = inserted[0];
      if (!t) throw new Error("emailThreads insert returning was empty");
      threadId = t.id;
    }

    await db.insert(emailMessages).values({
      threadId,
      gmailMessageId: sent.id,
      kind: "email",
      direction: "outbound",
      fromAddress: inbox.email,
      toAddresses: [to],
      ccAddresses: [],
      bccAddresses: [],
      subject,
      bodyText: body,
      bodyHtml: htmlBody,
      snippet: body.slice(0, 140),
      gmailLabels: ["SENT"],
      sentAt: now,
      sentByStaffId: staff.id,
      staffOutreachEmailId: inbox.id,
    });

    // Apply any pre-selected team labels to the brand-new thread.
    // applyLabelToThread also mirrors to Gmail (lazy-creates the
    // Gmail-side label on this account if it's not linked yet).
    // Each label is applied independently so one Gmail-side failure
    // doesn't block the rest. Errors are logged inside the helper.
    for (const labelId of labelIds) {
      try {
        await applyLabelToThread({
          threadId,
          teamLabelId: labelId,
          appliedBy: staff.id,
          via: "manual",
        });
      } catch (err) {
        logger.warn(
          { err, threadId, labelId },
          "composeAndSend: applyLabelToThread failed after send",
        );
      }
    }
  } catch (err) {
    logger.error({ err, fromAccountId, to }, "composeAndSend: DB write failed AFTER Gmail send");
    return {
      ok: false,
      error: "The email sent, but couldn't save the record. Refresh the inbox.",
    };
  }

  // Record the cap-counting event. Failures here are logged but
  // don't fail the action — the email is already out the door and
  // the thread is recorded; an under-counted send is recoverable.
  try {
    await recordSendEvent({
      connectedAccountId: fromAccountId,
      threadId,
      sentByUserId: staff.id,
      recipientEmail: to,
      category: sendCategory,
      capBypassed,
      templateId,
      teamId: staff.teamId,
    });
  } catch (err) {
    logger.error({ err, fromAccountId, threadId }, "composeAndSend: recordSendEvent failed");
  }

  revalidatePath("/inbox");
  return { ok: true, threadId };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
