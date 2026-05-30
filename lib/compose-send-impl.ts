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
import { db } from "@/lib/db";
import { sendGmailMessage } from "@/lib/gmail";
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

  // Preflight: classify + check the cold-send cap. composeAndSend
  // always creates a NEW thread (no prior inbound history), so it's
  // always cold. Admin can override via bypassCap form field.
  const bypassCap = String(formData.get("bypassCap") ?? "") === "1";
  const preflight = await preflightSend({
    connectedAccountId: fromAccountId,
    threadId: null,
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
  const sendCategory = preflight.ok ? preflight.category : preflight.category; // 'cold' either way for composeAndSend
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
