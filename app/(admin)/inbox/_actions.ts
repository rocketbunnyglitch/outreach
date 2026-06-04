"use server";

/**
 * Inbox server actions.
 *
 * Phase: post-Gmail-poll. Now that messages ingest, operators need to
 * actually DO things in the inbox -- reply, mark interested, archive,
 * assign to a slot, mark as read. This file holds those actions.
 *
 * Naming pattern matches the rest of the engine: each action takes
 * (prev, formData) so it composes with React useFormState. The
 * non-form helpers (markThreadRead, archiveThread) take typed args.
 */

import {
  connectedAccounts,
  emailDrafts,
  emailMessages,
  emailSuppression,
  emailThreads,
  staffOutreachEmails,
  teamLabels,
} from "@/db/schema";
import { draftReply } from "@/lib/ai-reply";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { extractEmailAddress } from "@/lib/email-address";
import { sanitizeEmailHtml } from "@/lib/email-sanitize";
import { clearCadenceOnAction } from "@/lib/follow-up-cadence";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { modifyGmailThreadLabels, sendGmailMessage } from "@/lib/gmail";
import {
  applyGmailLabelToThread,
  createGmailLabelForAccount,
  listGmailLabelsForThread,
  removeGmailLabelFromThread,
} from "@/lib/gmail-thread-labels";
import { logger } from "@/lib/logger";
import { newOpError } from "@/lib/op-error";
import { publishRealtime } from "@/lib/realtime-publish";
import { preflightSend, recordSendEvent } from "@/lib/send-cap";
import { describeBlock, runSendSafety } from "@/lib/send-safety";
import { clearStaleOnAction } from "@/lib/stale-tagger";
import {
  applyLabelToThread,
  listTeamLabels,
  listThreadLabels,
  removeLabelFromThread,
} from "@/lib/team-labels";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

// =========================================================================
// Reply: send a message into an existing thread
// =========================================================================

const replySchema = z.object({
  threadId: uuid,
  body: z.string().trim().min(1, "Reply body can't be empty.").max(50_000),
});

export async function sendThreadReply(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ messageId: string; threadId: string }>> {
  const { staff } = await requireStaff();
  // Readonly role can view threads but never send.
  if (!hasMinimumRole(staff, "outreach")) {
    return { ok: false, error: "Read-only access -- you can view mail but cannot send it." };
  }
  const parsed = replySchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { ok: false, error: "Reply text is required." };
  }
  const { threadId, body } = parsed.data;

  // Load the thread + the most recent inbound message (we'll reply to
  // it). TEAM-SCOPED: inner-join the connected account and require it
  // be on the operator's team so a thread id from another team can't
  // be replied to (cross-team IDOR + impersonation).
  const threadRow = await db
    .select({
      thread: emailThreads,
      lastInboundMessageId: sql<string | null>`(
        SELECT em.rfc_message_id FROM email_messages em
        WHERE em.thread_id = ${emailThreads.id}
          AND em.direction = 'inbound'
        ORDER BY em.sent_at DESC
        LIMIT 1
      )`,
    })
    .from(emailThreads)
    .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, emailThreads.staffOutreachEmailId))
    .where(and(eq(emailThreads.id, threadId), eq(staffOutreachEmails.teamId, staff.teamId)))
    .limit(1);

  const row = threadRow[0];
  if (!row) return { ok: false, error: "Thread not found or not on your team." };

  // Resolve the inbox + refresh token to send from.
  const inbox = await db
    .select({
      id: staffOutreachEmails.id,
      email: staffOutreachEmails.emailAddress,
      token: staffOutreachEmails.gmailOauthRefreshToken,
      ownerUserId: staffOutreachEmails.ownerUserId,
    })
    .from(staffOutreachEmails)
    .where(eq(staffOutreachEmails.id, row.thread.staffOutreachEmailId))
    .limit(1);

  const senderInbox = inbox[0];
  // Send-ownership gate: only the inbox owner (or an admin) may reply
  // from it. View access to a team thread does not grant the right to
  // reply under the owner's identity.
  if (
    senderInbox?.ownerUserId &&
    senderInbox.ownerUserId !== staff.id &&
    !hasMinimumRole(staff, "admin")
  ) {
    return {
      ok: false,
      error: "You can view this thread but can't reply from its inbox (not yours).",
    };
  }
  if (!senderInbox || !senderInbox.token) {
    return {
      ok: false,
      error: "The original inbox isn't connected to Gmail anymore. Re-connect it in Settings.",
    };
  }

  // Resolve recipient: the last inbound message's from_address
  const lastInbound = await db
    .select({
      from: emailMessages.fromAddress,
      subject: emailMessages.subject,
    })
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, threadId), eq(emailMessages.direction, "inbound")))
    .orderBy(sql`${emailMessages.sentAt} DESC`)
    .limit(1);

  const recipient = extractEmail(lastInbound[0]?.from ?? "");
  if (!recipient) {
    return { ok: false, error: "Couldn't determine where to send the reply." };
  }

  // Send-safety on the recipient. Replies to suppressed/DNC
  // addresses are hard-blocked just like compose. Duplicate-outreach
  // detection excludes THIS thread (a reply on the thread isn't a
  // duplicate of itself).
  const safety = await runSendSafety({
    teamId: staff.teamId,
    staffId: staff.id,
    to: recipient,
    excludeThreadId: threadId,
    venueId: row.thread.venueId ?? null,
  });
  if (!safety.ok) {
    return { ok: false, error: describeBlock(safety.block) };
  }
  const ackDuplicates = String(formData.get("ackDuplicates") ?? "") === "1";
  if (safety.warnings.length > 0 && !ackDuplicates) {
    // Priority order matches compose path:
    //   1. recent_decline
    //   2. cross_staff_owner
    //   3. duplicate
    // See lib/compose-send-impl.ts for the rationale.
    const declineWarning = safety.warnings.find((w) => w.kind === "recent_decline");
    const crossStaff = safety.warnings.find((w) => w.kind === "cross_staff_owner");
    let message: string;
    if (declineWarning && declineWarning.kind === "recent_decline") {
      const eventBit = declineWarning.eventLabel ? ` (${declineWarning.eventLabel})` : "";
      message = `${declineWarning.venueName} declined ${declineWarning.daysAgo} day${declineWarning.daysAgo === 1 ? "" : "s"} ago${eventBit}. Re-send to confirm.`;
    } else if (crossStaff && crossStaff.kind === "cross_staff_owner") {
      const ownerBit = crossStaff.ownerStaffName ?? "Another teammate";
      const eventBit = crossStaff.eventLabel ? ` (${crossStaff.eventLabel})` : "";
      message = `${ownerBit} is contacting ${crossStaff.venueName}${eventBit}. Re-send to confirm.`;
    } else {
      const dupCount = safety.warnings.filter((w) => w.kind === "duplicate").length;
      message = `Possible duplicate outreach (${dupCount} other open thread${dupCount === 1 ? "" : "s"} to this address). Re-send to confirm.`;
    }
    return {
      ok: false,
      error: message,
    };
  }

  // Build the Re: subject
  const baseSubject = row.thread.subject ?? lastInbound[0]?.subject ?? "(no subject)";
  const subject = baseSubject.toLowerCase().startsWith("re:") ? baseSubject : `Re: ${baseSubject}`;

  // Rich HTML body if the composer supplied one (the popout
  // composer routes through composeAndSendImpl, not here -- but a
  // future inline rich editor could send bodyHtml through this
  // path too). Fall back to a light text→HTML when the form only
  // has plain text. Either path is sanitized so XSS can't reach
  // the wire or email_messages.body_html.
  const bodyHtmlFromForm = String(formData.get("bodyHtml") ?? "");
  const synthesizedHtml = body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const htmlBody =
    sanitizeEmailHtml(bodyHtmlFromForm.trim().length > 0 ? bodyHtmlFromForm : synthesizedHtml) ??
    synthesizedHtml;

  // 140-char snippet that survives HTML-only payloads.
  const derivedSnippet = (body.trim().length > 0 ? body : htmlBody.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

  // Preflight cold-send cap. Replies almost always classify warm
  // (the thread has inbound history), but a reply on a thread that
  // only has outbound messages -- say the operator hits Reply on
  // their own sent message -- comes back cold and consumes a slot.
  // Admin override via the form's bypassCap flag.
  const bypassCap = String(formData.get("bypassCap") ?? "") === "1";
  const preflight = await preflightSend({
    connectedAccountId: senderInbox.id,
    threadId,
  });
  if (!preflight.ok) {
    if (!bypassCap || !hasMinimumRole(staff, "admin")) {
      return {
        ok: false,
        error: `Daily cold-send cap reached on ${senderInbox.email} (${preflight.usage.used} / ${preflight.usage.cap}). ${
          hasMinimumRole(staff, "admin")
            ? "Click 'Bypass cap' to send anyway."
            : "Wait for the daily reset, or ask an admin to bypass."
        }`,
      };
    }
    logger.warn(
      { threadId, userId: staff.id, used: preflight.usage.used, cap: preflight.usage.cap },
      "sendThreadReply: admin bypassed cold-send cap",
    );
  }
  const sendCategory = preflight.ok ? preflight.category : preflight.category;
  const capBypassed = !preflight.ok && bypassCap;

  // Send via Gmail
  let sentId: string;
  let sentThreadId: string;
  try {
    const result = await sendGmailMessage({
      encryptedRefreshToken: senderInbox.token,
      from: senderInbox.email,
      to: recipient,
      subject,
      htmlBody,
      textBody: body.trim().length > 0 ? body : htmlBody.replace(/<[^>]*>/g, "").trim(),
      threadId: row.thread.gmailThreadId,
      replyToMessageId: row.lastInboundMessageId ?? undefined,
    });
    sentId = result.id;
    sentThreadId = result.threadId;
  } catch (err) {
    const op = newOpError("inbox.sendThreadReply");
    op.log(err, { threadId });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't send the reply.",
      code: op.code,
    };
  }

  const now = new Date();

  // Insert the outbound row + flip thread state to waiting_on_them
  try {
    await db.insert(emailMessages).values({
      threadId,
      gmailMessageId: sentId,
      kind: "email",
      direction: "outbound",
      fromAddress: senderInbox.email,
      toAddresses: [recipient],
      ccAddresses: [],
      bccAddresses: [],
      // Normalized columns. `recipient` was already produced via
      // extractEmail() from the last inbound's from_address, which
      // strips display names and lowercases -- exactly the
      // normalized form. senderInbox.email is the operator's clean
      // address. No further parsing required.
      fromEmailNormalized: senderInbox.email.toLowerCase(),
      toEmailsNormalized: [recipient.toLowerCase()],
      ccEmailsNormalized: [],
      bccEmailsNormalized: [],
      subject,
      bodyText: body,
      bodyHtml: htmlBody,
      snippet: derivedSnippet,
      gmailLabels: ["SENT"],
      sentAt: now,
      sentByStaffId: staff.id,
      staffOutreachEmailId: senderInbox.id,
    });

    await db
      .update(emailThreads)
      .set({
        state: "waiting_on_them",
        direction: "mixed",
        lastOutboundAt: now,
        messageCount: sql`${emailThreads.messageCount} + 1`,
        snippet: derivedSnippet,
        updatedBy: staff.id,
      })
      .where(eq(emailThreads.id, threadId));
  } catch (err) {
    logger.error({ err, threadId }, "thread reply DB write failed AFTER sending Gmail");
    // The message went out -- surface a soft warning rather than failing.
    return {
      ok: false,
      error: "The reply sent but couldn't be saved to the inbox view. Refresh the page.",
    };
  }

  // Record the send-cap counter event. Failure is logged, not fatal.
  try {
    await recordSendEvent({
      connectedAccountId: senderInbox.id,
      threadId,
      sentByUserId: staff.id,
      recipientEmail: recipient,
      category: sendCategory,
      capBypassed,
      // Inbox replies are freeform -- no template. Team scoped from
      // the calling staff (Phase C.1).
      templateId: null,
      teamId: staff.teamId,
    });
  } catch (err) {
    logger.error({ err, threadId }, "sendThreadReply: recordSendEvent failed");
  }

  // Operator action -- clear stale + cadence immediately rather than
  // waiting for the next cron tick. A reply (outbound) shouldn't
  // immediately clear cadence (it's still cold-no-reply until inbound),
  // but the act of operator engagement resets the timer: re-bootstrap
  // happens on the next cadence pass from the new lastOutboundAt.
  try {
    await clearStaleOnAction(threadId);
    await clearCadenceOnAction(threadId);
  } catch (err) {
    logger.error({ err, threadId }, "sendThreadReply: clear-stale/cadence failed");
  }

  revalidatePath(`/inbox/${threadId}`);
  revalidatePath("/inbox");
  publishRealtime({
    table: "email_threads",
    id: threadId,
    type: "update",
    byStaffId: staff.id,
    byStaffName: staff.displayName ?? null,
  });

  return { ok: true, data: { messageId: sentId, threadId: sentThreadId } };
}

// =========================================================================
// Mark thread read -- fired client-side when a thread is opened
// =========================================================================

export async function markThreadRead(threadId: string): Promise<ActionResult<{ ok: true }>> {
  const { staff } = await requireStaff();
  const parsed = uuid.safeParse(threadId);
  if (!parsed.success) return { ok: false, error: "Invalid thread id." };

  try {
    // Team-scope guard: the thread's connected account must be on the
    // operator's team (cross-team IDOR + cross-team Gmail mutation).
    const [owned] = await db
      .select({ id: emailThreads.id })
      .from(emailThreads)
      .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, emailThreads.staffOutreachEmailId))
      .where(and(eq(emailThreads.id, threadId), eq(staffOutreachEmails.teamId, staff.teamId)))
      .limit(1);
    if (!owned) return { ok: false, error: "Thread not on your team." };

    await db
      .update(emailThreads)
      .set({ unreadCount: 0, updatedBy: staff.id })
      .where(eq(emailThreads.id, threadId));
    // Mark every inbound message as read too
    await db.execute(sql`
      UPDATE email_messages
      SET read_at = NOW()
      WHERE thread_id = ${threadId}
        AND direction = 'inbound'
        AND read_at IS NULL
    `);

    // Mirror to Gmail by removing the UNREAD system label. Without
    // this, the operator's Gmail account stays bold/unread even
    // after they viewed the thread in the engine -- the engine and
    // Gmail get out of sync, and operators get notification
    // duplicates (engine cleared the badge, Gmail still buzzes
    // their phone). Best-effort: Gmail API failure logs but doesn't
    // fail the engine-side mark-read.
    //
    // Asymmetric to setThreadStar: read-state is per-MESSAGE in
    // Gmail, not per-thread. threads.modify removing UNREAD acts
    // on every message in the thread -- matches operator intent
    // ("I've seen all of this").
    // Fire-and-forget: the Gmail round-trip is the slow part of this action
    // and engine state is already committed. Backgrounding it lets the UI
    // reflect read-state instantly (the helper is fully guarded, never rejects).
    void mirrorGmailLabels({
      threadId,
      removeLabelIds: ["UNREAD"],
      context: "markThreadRead",
    });

    // Revalidate so the cached /inbox list + thread RSC re-fetch with
    // unread_count=0. Without this, opening a thread cleared the DB but
    // the row stayed bold until a hard refresh (the optimistic clear in
    // ThreadRow handles the instant feedback; this makes it durable).
    // Mirrors markThreadUnread, which already revalidates both paths.
    revalidatePath(`/inbox/${threadId}`);
    revalidatePath("/inbox");

    publishRealtime({
      table: "email_threads",
      id: threadId,
      type: "update",
      byStaffId: staff.id,
      byStaffName: staff.displayName ?? null,
    });
    return { ok: true, data: { ok: true } };
  } catch (err) {
    logger.error({ err, threadId }, "markThreadRead failed");
    return { ok: false, error: "Couldn't update read state." };
  }
}

/**
 * markThreadUnread -- counterpart to markThreadRead. Sets unread_count
 * to 1 so the thread re-surfaces in unread filters + the row badge
 * comes back. Doesn't touch email_messages.read_at -- the per-message
 * read state is separate and tracking which specific message to
 * re-flag isn't a useful distinction at the operator level.
 */
export async function markThreadUnread(threadId: string): Promise<ActionResult<{ ok: true }>> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };
  try {
    // Team-scope guard (cross-team IDOR + cross-team Gmail mutation).
    const [owned] = await db
      .select({ id: emailThreads.id })
      .from(emailThreads)
      .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, emailThreads.staffOutreachEmailId))
      .where(and(eq(emailThreads.id, threadId), eq(staffOutreachEmails.teamId, staff.teamId)))
      .limit(1);
    if (!owned) return { ok: false, error: "Thread not on your team." };

    await db
      .update(emailThreads)
      .set({ unreadCount: 1, updatedBy: staff.id })
      .where(eq(emailThreads.id, threadId));

    // Mirror to Gmail by ADDING the UNREAD system label, the inverse
    // of markThreadRead. Without this, marking unread in the engine
    // left Gmail read -- one-way sync. Best-effort; logs on failure.
    // Fire-and-forget (see markThreadRead): instant UI, Gmail syncs in the bg.
    void mirrorGmailLabels({
      threadId,
      addLabelIds: ["UNREAD"],
      context: "markThreadUnread",
    });

    revalidatePath(`/inbox/${threadId}`);
    revalidatePath("/inbox");
    publishRealtime({
      table: "email_threads",
      id: threadId,
      type: "update",
      byStaffId: staff.id,
      byStaffName: staff.displayName ?? null,
    });
    return { ok: true, data: { ok: true } };
  } catch (err) {
    logger.error({ err, threadId }, "markThreadUnread failed");
    return { ok: false, error: "Couldn't update unread state." };
  }
}

// =========================================================================
// Change thread state (interested / declined / closed / archived)
// =========================================================================

const stateSchema = z.object({
  threadId: uuid,
  state: z.enum([
    "needs_reply",
    "waiting_on_them",
    "follow_up_due",
    "closed_won",
    "closed_lost",
    "closed_dnc",
    "archived",
  ]),
});

export async function setThreadState(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ ok: true }>> {
  const { staff } = await requireStaff();
  const parsed = stateSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid state value." };

  const { threadId, state } = parsed.data;
  try {
    await db
      .update(emailThreads)
      .set({
        state,
        archivedAt: state === "archived" ? new Date() : null,
        updatedBy: staff.id,
        // State change is operator action; clear stale + cadence
        // immediately so the inbox UI reflects it without waiting
        // for cron. If the new state is still 'open' (waiting/
        // needs_reply), the next cadence pass will re-bootstrap;
        // for closed states, cadence stays cleared (terminal).
        isStale: false,
        staleSince: null,
        staleReason: null,
        followUpStage: 0,
        followUpNextDueAt: null,
      })
      .where(eq(emailThreads.id, threadId));

    // Mirror archive transitions to Gmail. Gmail represents
    // archive as "INBOX label removed"; everything else
    // (re-active, manually moved to a folder) just adds INBOX
    // back. Other engine states (closed, won, lost, etc.) don't
    // have a clean Gmail mirror -- we leave the Gmail INBOX
    // label alone for those. The operator may have their own
    // Gmail-side organization that we shouldn't override.
    // Fire-and-forget the Gmail mirror (the slow part); archive/unarchive
    // reflects in the UI immediately and Gmail catches up in the background.
    if (state === "archived") {
      void mirrorGmailLabels({
        threadId,
        removeLabelIds: ["INBOX"],
        context: "setThreadState:archive",
      });
    } else {
      // Previous state was archived; un-archiving puts the
      // thread back into the inbox view. Bring back the INBOX
      // label. Idempotent -- if INBOX was never removed, this
      // is a no-op on Gmail's side.
      void mirrorGmailLabels({
        threadId,
        addLabelIds: ["INBOX"],
        context: "setThreadState:unarchive",
      });
    }

    // Cancel pending cadence tasks for threads moving to a
    // terminal state. archived/closed/won/lost mean the operator
    // is done with the thread; the auto "Call follow-up" tasks
    // are noise from here on. open/working states (needs_reply /
    // waiting_on_them / follow_up_due) keep their tasks.
    const TERMINAL_STATES: ReadonlySet<string> = new Set(["archived", "closed", "won", "lost"]);
    if (TERMINAL_STATES.has(state)) {
      await cancelAutoTasksForThreads({
        threadIds: [threadId],
        staffId: staff.id,
        context: `setThreadState:${state}`,
      });
    }

    revalidatePath(`/inbox/${threadId}`);
    revalidatePath("/inbox");
    publishRealtime({
      table: "email_threads",
      id: threadId,
      type: "update",
      byStaffId: staff.id,
      byStaffName: staff.displayName ?? null,
    });
    return { ok: true, data: { ok: true } };
  } catch (err) {
    logger.error({ err, threadId, state }, "setThreadState failed");
    return { ok: false, error: "Couldn't update thread state." };
  }
}

// =========================================================================
// Helpers
// =========================================================================

/**
 * Best-effort Gmail label mirror for a SINGLE thread.
 *
 * Used by every engine-side action that maps to a Gmail label
 * change: star (STARRED), archive (INBOX removal), trash (TRASH),
 * read (UNREAD removal), and their inverses. The engine state has
 * already been written by the caller; this only mirrors the
 * decision to Gmail so the operator's mailbox stays in sync.
 *
 * Errors are logged + swallowed. Engine state is canonical;
 * eventual consistency via the next poll cycle recovers from
 * Gmail-side failures.
 *
 * Returns true if a mirror was attempted (token + gmail_thread_id
 * both present), false if no Gmail context was available (e.g.
 * thread never had a gmail_thread_id because it was created
 * before Gmail integration).
 */
async function mirrorGmailLabels(opts: {
  threadId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
  context: string;
}): Promise<boolean> {
  if ((opts.addLabelIds?.length ?? 0) === 0 && (opts.removeLabelIds?.length ?? 0) === 0) {
    return false;
  }
  try {
    const [acct] = await db
      .select({
        gmailThreadId: emailThreads.gmailThreadId,
        token: connectedAccounts.gmailOauthRefreshToken,
      })
      .from(emailThreads)
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
      .where(eq(emailThreads.id, opts.threadId))
      .limit(1);
    if (!acct?.token || !acct.gmailThreadId) return false;
    await modifyGmailThreadLabels({
      encryptedRefreshToken: acct.token,
      gmailThreadId: acct.gmailThreadId,
      addLabelIds: opts.addLabelIds,
      removeLabelIds: opts.removeLabelIds,
    });
    return true;
  } catch (err) {
    logger.warn(
      { err, threadId: opts.threadId, context: opts.context },
      "mirrorGmailLabels failed (engine state already updated)",
    );
    return false;
  }
}

/**
 * Best-effort Gmail label mirror for a BATCH of threads. Iterates
 * per thread because each may be in a different connected_account
 * with its own token. Per-thread failures log but don't fail the
 * batch -- engine state is canonical for the rest.
 *
 * Returns the count of successful mirrors. Caller can log this
 * for observability but typically doesn't need to act on it.
 */
async function mirrorGmailLabelsBatch(opts: {
  threadIds: string[];
  addLabelIds?: string[];
  removeLabelIds?: string[];
  context: string;
}): Promise<number> {
  if (opts.threadIds.length === 0) return 0;
  if ((opts.addLabelIds?.length ?? 0) === 0 && (opts.removeLabelIds?.length ?? 0) === 0) {
    return 0;
  }
  let ok = 0;
  // Fully guarded so the function can be fire-and-forget'd by callers without
  // risking an unhandled rejection (the initial db.select is now inside the
  // try too). Engine state is already committed before this runs.
  try {
    const rows = await db
      .select({
        threadId: emailThreads.id,
        gmailThreadId: emailThreads.gmailThreadId,
        token: connectedAccounts.gmailOauthRefreshToken,
      })
      .from(emailThreads)
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
      .where(inArray(emailThreads.id, opts.threadIds));
    for (const row of rows) {
      if (!row.token || !row.gmailThreadId) continue;
      try {
        await modifyGmailThreadLabels({
          encryptedRefreshToken: row.token,
          gmailThreadId: row.gmailThreadId,
          addLabelIds: opts.addLabelIds,
          removeLabelIds: opts.removeLabelIds,
        });
        ok++;
      } catch (err) {
        logger.warn(
          { err, threadId: row.threadId, context: opts.context },
          "mirrorGmailLabelsBatch entry failed (engine state already updated)",
        );
      }
    }
  } catch (err) {
    logger.warn(
      { err, context: opts.context },
      "mirrorGmailLabelsBatch failed (engine state already updated)",
    );
  }
  return ok;
}

/**
 * Cancel pending cadence tasks for threads moving to a terminal
 * state.
 *
 * When an operator archives, trashes, or otherwise closes out a
 * thread, any pending auto-generated "Call follow-up" tasks
 * targeting that thread no longer make sense -- the operator
 * already decided this thread is done. Leaving them as 'pending'
 * clutters the task list and triggers SLA-overdue alerts for
 * tasks the operator implicitly already handled.
 *
 * Only auto-tasks (source='auto') are cancelled. Manual tasks
 * the operator created on the same thread stay untouched --
 * those represent the operator's own deliberate work, not the
 * cadence engine's guess.
 *
 * Status transition: pending|in_progress -> cancelled.
 * 'completed' tasks are not touched (history is history).
 *
 * Best-effort -- a failure logs but does NOT fail the thread
 * action. Engine thread state is the canonical signal; lingering
 * task rows are an annoyance, not a correctness issue.
 *
 * Returns the count of cancelled tasks for the caller to log.
 */
async function cancelAutoTasksForThreads(opts: {
  threadIds: string[];
  staffId: string;
  context: string;
}): Promise<number> {
  if (opts.threadIds.length === 0) return 0;
  try {
    const result = await db.execute<{ id: string }>(sql`
      UPDATE tasks
      SET
        status = 'cancelled',
        updated_at = NOW(),
        updated_by = ${opts.staffId}
      WHERE source = 'auto'
        AND target_type = 'email_thread'
        AND target_id IN (${sql.join(
          opts.threadIds.map((id) => sql`${id}`),
          sql`, `,
        )})
        AND status IN ('pending', 'in_progress')
      RETURNING id
    `);
    const rows = Array.isArray(result)
      ? result
      : ((result as { rows?: Array<{ id: string }> }).rows ?? []);
    return rows.length;
  } catch (err) {
    logger.warn(
      { err, threadCount: opts.threadIds.length, context: opts.context },
      "cancelAutoTasksForThreads failed (thread state already updated)",
    );
    return 0;
  }
}

/**
 * setThreadStar -- toggle the Gmail-style star on a thread. Engine-side
 * only in v1; a future cron can two-way sync to Gmail using the OAuth
 * creds on the connected_account.
 *
 * Auth: requireStaff + team-scoped (thread's connected account must be
 * on the operator's team). No role gating -- anyone on the team can
 * star/unstar shared threads, same as Gmail.
 */
export async function setThreadStar(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ isStarred: boolean }>> {
  const { staff } = await requireStaff();
  const threadId = String(formData.get("threadId") ?? "");
  const starredRaw = String(formData.get("starred") ?? "");
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };
  if (starredRaw !== "true" && starredRaw !== "false") {
    return { ok: false, error: "Invalid star state." };
  }
  const isStarred = starredRaw === "true";

  try {
    // Verify the thread is on the operator's team before updating.
    const [row] = await db
      .select({
        teamId: connectedAccounts.teamId,
      })
      .from(emailThreads)
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
      .where(eq(emailThreads.id, threadId))
      .limit(1);
    if (!row || row.teamId !== staff.teamId) {
      return { ok: false, error: "Thread not on your team." };
    }

    await db
      .update(emailThreads)
      .set({ isStarred, updatedBy: staff.id })
      .where(eq(emailThreads.id, threadId));

    // Mirror to Gmail's STARRED system label so the operator's
    // Gmail inbox stays in sync with the engine's star state.
    // Two-way sync per the 10/10 spec: engine -> Gmail is here,
    // Gmail -> engine handled on ingest in gmail-poll-worker.
    //
    // Best-effort -- if the Gmail call fails (network, expired
    // token, deleted thread on the Gmail side) we log + return
    // success to the operator. The engine-side state is the
    // canonical source the UI shows; eventual consistency with
    // Gmail is the goal, not a hard requirement.
    void mirrorGmailLabels({
      threadId,
      addLabelIds: isStarred ? ["STARRED"] : [],
      removeLabelIds: isStarred ? [] : ["STARRED"],
      context: "setThreadStar",
    });

    revalidatePath(`/inbox/${threadId}`);
    revalidatePath("/inbox");
    publishRealtime({
      table: "email_threads",
      id: threadId,
      type: "update",
      byStaffId: staff.id,
      byStaffName: staff.displayName ?? null,
    });
    return { ok: true, data: { isStarred } };
  } catch (err) {
    logger.error({ err, threadId, isStarred }, "setThreadStar failed");
    return { ok: false, error: "Couldn't update star." };
  }
}

/**
 * setThreadNeedsAttention -- flag or clear a thread for human triage (Phase
 * 1.14). The auto-classifier sets needs_attention=true when it lands below the
 * Reference Doc 8.4 confidence floor; the worklist (Phase 2) surfaces flagged
 * threads first. The operator clears the flag here once triaged. Distinct from
 * is_stale (SLA staleness). Auth: requireStaff + team-scoped. [ReferenceDoc 8.4]
 */
export async function setThreadNeedsAttention(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ needsAttention: boolean }>> {
  const { staff } = await requireStaff();
  const threadId = String(formData.get("threadId") ?? "");
  const raw = String(formData.get("needsAttention") ?? "");
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };
  if (raw !== "true" && raw !== "false") return { ok: false, error: "Invalid attention state." };
  const needsAttention = raw === "true";

  try {
    // Verify the thread is on the operator's team before updating.
    const [row] = await db
      .select({ teamId: connectedAccounts.teamId })
      .from(emailThreads)
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
      .where(eq(emailThreads.id, threadId))
      .limit(1);
    if (!row || row.teamId !== staff.teamId) {
      return { ok: false, error: "Thread not on your team." };
    }

    await db
      .update(emailThreads)
      .set({ needsAttention, updatedBy: staff.id })
      .where(eq(emailThreads.id, threadId));

    revalidatePath(`/inbox/${threadId}`);
    revalidatePath("/inbox");
    publishRealtime({
      table: "email_threads",
      id: threadId,
      type: "update",
      byStaffId: staff.id,
      byStaffName: staff.displayName ?? null,
    });
    return { ok: true, data: { needsAttention } };
  } catch (err) {
    logger.error({ err, threadId }, "setThreadNeedsAttention failed");
    return { ok: false, error: "Couldn't update attention flag." };
  }
}

/**
 * setThreadTrash -- soft-delete a thread (move to Trash) or restore it.
 *
 * Sets / clears email_threads.deleted_at. The Trash mailbox view shows
 * deleted_at IS NOT NULL; every other view filters them out. Recoverable
 * indefinitely from /inbox?folder=trash. A future cron could hard-purge
 * after 30 days.
 *
 * Auth: requireStaff + team-scoped.
 */
export async function setThreadTrash(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ trashed: boolean }>> {
  const { staff } = await requireStaff();
  const threadId = String(formData.get("threadId") ?? "");
  const trashedRaw = String(formData.get("trashed") ?? "");
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };
  if (trashedRaw !== "true" && trashedRaw !== "false") {
    return { ok: false, error: "Invalid trash state." };
  }
  const trashed = trashedRaw === "true";

  try {
    const [row] = await db
      .select({ teamId: connectedAccounts.teamId })
      .from(emailThreads)
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
      .where(eq(emailThreads.id, threadId))
      .limit(1);
    if (!row || row.teamId !== staff.teamId) {
      return { ok: false, error: "Thread not on your team." };
    }

    await db
      .update(emailThreads)
      .set({
        deletedAt: trashed ? new Date() : null,
        updatedBy: staff.id,
      })
      .where(eq(emailThreads.id, threadId));

    // Mirror to Gmail TRASH. Trashing in Gmail moves the thread
    // OUT of inbox into the Trash folder (auto-expires after 30
    // days per Gmail policy); restoring puts it back. Asymmetric
    // with our engine: our `deletedAt` is permanent until
    // operator manually clears, no auto-expiry. We accept this
    // semantic mismatch -- operators who use restore expect a
    // round trip, not "restore from a deleted-forever state."
    //
    // Use the dedicated trash/untrash endpoints because they're
    // simpler than juggling the TRASH system label via
    // threads.modify; the API distinguishes the two operations.
    //
    // Skipped here as a follow-up: the dedicated endpoints aren't
    // wrapped in our gmail helper yet. For now we use the label
    // path which DOES work -- adding/removing the TRASH label
    // through threads.modify produces the same observable result.
    void mirrorGmailLabels({
      threadId,
      addLabelIds: trashed ? ["TRASH"] : [],
      removeLabelIds: trashed ? ["INBOX"] : ["TRASH"],
      context: trashed ? "setThreadTrash:trash" : "setThreadTrash:restore",
    });

    // Cancel pending cadence tasks when trashing. Restoring does
    // NOT re-create them; if the operator wants the cadence
    // re-bootstrapped they can set the thread back to a working
    // state (the cadence engine picks it back up on its next
    // pass).
    if (trashed) {
      await cancelAutoTasksForThreads({
        threadIds: [threadId],
        staffId: staff.id,
        context: "setThreadTrash",
      });
    }

    revalidatePath(`/inbox/${threadId}`);
    revalidatePath("/inbox");
    publishRealtime({
      table: "email_threads",
      id: threadId,
      type: "update",
      byStaffId: staff.id,
      byStaffName: staff.displayName ?? null,
    });
    return { ok: true, data: { trashed } };
  } catch (err) {
    logger.error({ err, threadId, trashed }, "setThreadTrash failed");
    return { ok: false, error: "Couldn't move thread to trash." };
  }
}

/**
 * reportThreadSpam -- apply Gmail's SPAM label to a thread + soft-delete
 * on our side so it stops showing in the inbox.
 *
 * Two-step:
 *   1. Call Gmail's threads.modify to addLabel SPAM + removeLabel INBOX
 *      so the operator's Gmail also reflects the spam classification.
 *      This is what trains Gmail's spam classifier for future
 *      messages from the same sender domain.
 *   2. Soft-delete our row (deletedAt = NOW) so the thread leaves
 *      every mailbox view immediately. Trash view will still surface
 *      it under the existing isTrashView path.
 *
 * Gmail call is best-effort: if it fails (revoked token, network),
 * we still complete the local soft-delete and return ok with a
 * `gmailReported: false` flag. The operator can manually mark as
 * spam in Gmail's web UI as fallback.
 *
 * Auth: requireStaff + team-scoped.
 */
export async function reportThreadSpam(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ gmailReported: boolean }>> {
  const { staff } = await requireStaff();
  const threadId = String(formData.get("threadId") ?? "");
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };

  try {
    const [row] = await db
      .select({
        teamId: connectedAccounts.teamId,
      })
      .from(emailThreads)
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
      .where(eq(emailThreads.id, threadId))
      .limit(1);
    if (!row || row.teamId !== staff.teamId) {
      return { ok: false, error: "Thread not on your team." };
    }

    // Best-effort Gmail SPAM label mutation. The local mirror
    // helper returns true on a successful mutation, false when no
    // Gmail context was available (no token / no gmail thread id)
    // or when the API call itself failed (logged at warn). That's
    // exactly the gmailReported boolean shape we want to return.
    const gmailReported = await mirrorGmailLabels({
      threadId,
      addLabelIds: ["SPAM"],
      removeLabelIds: ["INBOX"],
      context: "reportThreadSpam",
    });

    // Soft-delete locally so the thread leaves every mailbox view.
    await db
      .update(emailThreads)
      .set({
        deletedAt: new Date(),
        updatedBy: staff.id,
      })
      .where(eq(emailThreads.id, threadId));

    // Mark thread as spam = operator decided this thread is done +
    // the sender shouldn't have been pitched. Cancel any pending
    // auto cadence tasks for it.
    await cancelAutoTasksForThreads({
      threadIds: [threadId],
      staffId: staff.id,
      context: "reportThreadSpam",
    });

    revalidatePath(`/inbox/${threadId}`);
    revalidatePath("/inbox");
    publishRealtime({
      table: "email_threads",
      id: threadId,
      type: "update",
      byStaffId: staff.id,
      byStaffName: staff.displayName ?? null,
    });
    return { ok: true, data: { gmailReported } };
  } catch (err) {
    logger.error({ err, threadId }, "reportThreadSpam failed");
    return { ok: false, error: "Couldn't report thread as spam." };
  }
}

/**
 * blockThreadSender -- add the most-recent inbound sender's address
 * to the team's email_suppression list so we never send to them
 * again.
 *
 * Source of the address: the latest inbound email_message on the
 * thread. If the thread has no inbound messages (e.g. drafts-only),
 * the action returns an error since there's no sender to block.
 *
 * Idempotent: ON CONFLICT (team_id, email) DO NOTHING -- re-blocking
 * the same address is a no-op rather than an error.
 *
 * Doesn't auto-trash the thread (caller can trash separately if
 * they want). Doesn't touch Gmail -- the suppression list only
 * affects our send pipeline.
 *
 * Auth: requireStaff + team scope.
 */
export async function blockThreadSender(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ blocked: string }>> {
  const { staff } = await requireStaff();
  const threadId = String(formData.get("threadId") ?? "");
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };

  try {
    // Most recent inbound sender on the thread. Pull the normalized
    // email column (clean address, no display name, lowercase)
    // shipped in migration 0083 -- the raw fromAddress can be
    // something like '"Mike Smith" <mike@venue.com>' which, when
    // trimmed and lowercased, gets stored in email_suppression as
    // a malformed entry. Future sends compare suppression rows
    // against the clean recipient address; a malformed
    // suppression row never matches, so the block silently
    // fails to fire on the next send.
    //
    // Fall back to extracting from the raw fromAddress in the
    // unlikely case fromEmailNormalized is NULL (would only
    // happen on rows ingested before the 0083 backfill OR rows
    // the backfill couldn't parse). The extraction here is
    // best-effort -- if we can't get a clean address, reject
    // the block with an explicit error so the operator notices.
    const [latest] = await db
      .select({
        teamId: connectedAccounts.teamId,
        fromAddress: emailMessages.fromAddress,
        fromEmailNormalized: emailMessages.fromEmailNormalized,
      })
      .from(emailMessages)
      .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
      .where(and(eq(emailThreads.id, threadId), eq(emailMessages.direction, "inbound")))
      .orderBy(desc(emailMessages.sentAt))
      .limit(1);
    if (!latest) {
      return { ok: false, error: "This thread has no inbound messages -- nothing to block." };
    }
    if (latest.teamId !== staff.teamId) {
      return { ok: false, error: "Thread not on your team." };
    }

    // Prefer the normalized column. If it's NULL, fall back to
    // extracting the angle-bracketed address from the raw header.
    let email = latest.fromEmailNormalized?.trim().toLowerCase() ?? "";
    if (!email && latest.fromAddress) {
      // Look for <addr@host> first; if not present, treat the whole
      // value as the address (matches RFC 5322 bare-address form).
      const match = latest.fromAddress.match(/<([^>]+)>/);
      const candidate = (match?.[1] ?? latest.fromAddress).trim().toLowerCase();
      // Sanity: must contain exactly one '@' and have at least one
      // char on each side. Avoids inserting display-name junk.
      if (/^[^@\s]+@[^@\s]+$/.test(candidate)) email = candidate;
    }
    if (!email) {
      return { ok: false, error: "Couldn't parse a clean sender address from the latest inbound." };
    }

    await db
      .insert(emailSuppression)
      .values({
        teamId: staff.teamId,
        email,
        reason: "manual",
        notes: "Blocked via thread more menu",
        sourceThreadId: threadId,
        createdBy: staff.id,
      })
      .onConflictDoNothing({ target: [emailSuppression.teamId, emailSuppression.email] });

    revalidatePath("/admin/suppression");
    return { ok: true, data: { blocked: email } };
  } catch (err) {
    logger.error({ err, threadId }, "blockThreadSender failed");
    return { ok: false, error: "Couldn't block sender." };
  }
}

/**
 * setThreadSnooze -- snooze a thread until a future timestamp, or clear
 * an existing snooze (pass snoozeUntil="").
 *
 * Snoozed threads hide from inbox / smart views until snooze_until passes
 * (the query predicates check `snooze_until <= now()`). No background cron
 * required for re-surfacing; the SQL filter does the work.
 *
 * Auth: requireStaff + team-scoped.
 */
export async function setThreadSnooze(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ snoozeUntil: string | null }>> {
  const { staff } = await requireStaff();
  const threadId = String(formData.get("threadId") ?? "");
  const snoozeUntilRaw = String(formData.get("snoozeUntil") ?? "");
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };

  let snoozeUntil: Date | null = null;
  if (snoozeUntilRaw !== "") {
    const parsed = new Date(snoozeUntilRaw);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "Invalid snooze timestamp." };
    }
    if (parsed.getTime() <= Date.now()) {
      return { ok: false, error: "Snooze time must be in the future." };
    }
    // Cap absurdly far snoozes (>180d) so an operator typo doesn't
    // park a thread until next year.
    const maxFuture = Date.now() + 180 * 86_400_000;
    if (parsed.getTime() > maxFuture) {
      return { ok: false, error: "Snooze too far in the future (180 day max)." };
    }
    snoozeUntil = parsed;
  }

  try {
    const [row] = await db
      .select({ teamId: connectedAccounts.teamId })
      .from(emailThreads)
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
      .where(eq(emailThreads.id, threadId))
      .limit(1);
    if (!row || row.teamId !== staff.teamId) {
      return { ok: false, error: "Thread not on your team." };
    }

    await db
      .update(emailThreads)
      .set({ snoozeUntil, updatedBy: staff.id })
      .where(eq(emailThreads.id, threadId));

    revalidatePath(`/inbox/${threadId}`);
    revalidatePath("/inbox");
    publishRealtime({
      table: "email_threads",
      id: threadId,
      type: "update",
      byStaffId: staff.id,
      byStaffName: staff.displayName ?? null,
    });
    return {
      ok: true,
      data: { snoozeUntil: snoozeUntil?.toISOString() ?? null },
    };
  } catch (err) {
    logger.error({ err, threadId, snoozeUntilRaw }, "setThreadSnooze failed");
    return { ok: false, error: "Couldn't snooze thread." };
  }
}

/**
 * bulkUpdateThreads -- apply one of a handful of toggles to a list of
 * thread ids. Used by the inbox top toolbar when the operator has
 * selected one or more rows.
 *
 * Supported actions:
 *   star          -- is_starred = true
 *   unstar        -- is_starred = false
 *   trash         -- deleted_at = now()
 *   restore       -- deleted_at = null (un-trash)
 *   archive       -- state = 'archived' + archived_at = now()
 *   mark_read     -- unread_count = 0 (clears the unread badge)
 *   mark_unread   -- unread_count = 1 (resurfaces the unread badge)
 *
 * Auth: requireStaff + team-scoped on every id (WHERE clause includes
 * the team_id check via the joined connected_accounts row).
 *
 * Returns the count of rows actually updated -- useful for the toast
 * "Archived 12 threads" feedback.
 */
export async function bulkUpdateThreads(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ updated: number }>> {
  const { staff } = await requireStaff();
  const action = String(formData.get("action") ?? "");
  const idsRaw = String(formData.get("threadIds") ?? "");
  const ids = idsRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
  if (ids.length === 0) return { ok: false, error: "No threads selected." };
  if (ids.length > 200) return { ok: false, error: "Too many threads (200 max per batch)." };

  const allowed = [
    "star",
    "unstar",
    "trash",
    "restore",
    "archive",
    "unarchive",
    "mark_read",
    "mark_unread",
  ] as const;
  type Action = (typeof allowed)[number];
  if (!(allowed as readonly string[]).includes(action)) {
    return { ok: false, error: "Invalid action." };
  }
  const act = action as Action;

  // Team-scope: select only ids the operator's team owns. The bulk
  // update is then restricted to those ids, so a malicious client
  // can't sneak in cross-team ids.
  const scoped = await db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
    .where(and(eq(connectedAccounts.teamId, staff.teamId), inArray(emailThreads.id, ids)));
  const okIds = scoped.map((r) => r.id);
  if (okIds.length === 0) return { ok: false, error: "No matching threads on your team." };

  type Patch = Partial<typeof emailThreads.$inferInsert>;
  const patch: Patch = { updatedBy: staff.id };
  const now = new Date();
  switch (act) {
    case "star":
      patch.isStarred = true;
      break;
    case "unstar":
      patch.isStarred = false;
      break;
    case "trash":
      patch.deletedAt = now;
      break;
    case "restore":
      patch.deletedAt = null;
      break;
    case "archive":
      patch.state = "archived";
      patch.archivedAt = now;
      patch.isStale = false;
      patch.staleSince = null;
      patch.staleReason = null;
      patch.followUpStage = 0;
      patch.followUpNextDueAt = null;
      break;
    case "unarchive":
      // Restore an archived thread back to active. We don't try to
      // remember the prior state (the engine doesn't store the
      // pre-archive state); needs_reply is the right default --
      // operator can re-classify after the thread re-surfaces.
      patch.state = "needs_reply";
      patch.archivedAt = null;
      break;
    case "mark_read":
      patch.unreadCount = 0;
      break;
    case "mark_unread":
      patch.unreadCount = 1;
      break;
  }

  try {
    await db.update(emailThreads).set(patch).where(inArray(emailThreads.id, okIds));

    // Per-message read_at parity with markThreadRead. Setting just
    // email_threads.unread_count=0 (the patch above) cleared the
    // unread badge in the UI but left email_messages.read_at NULL
    // on the underlying inbound messages. Anything downstream that
    // reads from email_messages.read_at (per-message receipts,
    // future read-time analytics) would then see "never read" rows
    // for threads the operator HAS marked read. Mirror the per-
    // thread action's behavior here so single-thread and bulk
    // mark-read produce identical row state.
    //
    // Symmetric: bulk mark_unread doesn't reset read_at because the
    // per-thread markThreadUnread doesn't either -- read_at is a
    // first-time-read timestamp, not a recurring state. Toggling
    // unread on after read doesn't un-read history.
    if (act === "mark_read") {
      // Use drizzle inArray, NOT sql`= ANY(${okIds}::uuid[])`: interpolating a
      // JS array into a raw sql template binds each element as a separate
      // parameter, so the ::uuid[] cast receives a bare uuid string and Postgres
      // throws "malformed array literal". That broke bulk mark-read entirely.
      await db
        .update(emailMessages)
        .set({ readAt: now })
        .where(
          and(
            inArray(emailMessages.threadId, okIds),
            eq(emailMessages.direction, "inbound"),
            isNull(emailMessages.readAt),
          ),
        );
    }

    // Gmail mirror for every action that maps to a Gmail label
    // change. Without this the engine + Gmail drift: operator
    // archives in the engine, Gmail still shows the thread in
    // inbox; operator stars in the engine, Gmail doesn't.
    // Routed through mirrorGmailLabelsBatch which iterates per
    // thread (different connected_accounts have different
    // tokens) and logs per-thread failures without failing the
    // whole batch.
    //
    // Action -> label transition table:
    //   star        +STARRED
    //   unstar      -STARRED
    //   archive     -INBOX
    //   unarchive   +INBOX
    //   trash       +TRASH, -INBOX
    //   restore     -TRASH
    //   mark_read   -UNREAD
    //   mark_unread +UNREAD
    //
    // Note: archive/unarchive don't touch UNREAD; trashing doesn't
    // touch UNREAD either. Read-state is a separate concern that
    // operators may want independent of archive/trash state.
    let addLabels: string[] = [];
    let removeLabels: string[] = [];
    switch (act) {
      case "star":
        addLabels = ["STARRED"];
        break;
      case "unstar":
        removeLabels = ["STARRED"];
        break;
      case "archive":
        removeLabels = ["INBOX"];
        break;
      case "unarchive":
        addLabels = ["INBOX"];
        break;
      case "trash":
        addLabels = ["TRASH"];
        removeLabels = ["INBOX"];
        break;
      case "restore":
        removeLabels = ["TRASH"];
        break;
      case "mark_read":
        removeLabels = ["UNREAD"];
        break;
      case "mark_unread":
        addLabels = ["UNREAD"];
        break;
    }
    // Fire-and-forget: this iterates one Gmail call PER thread, so for a bulk
    // selection it was the dominant latency. Backgrounding it makes bulk
    // archive / mark-read feel instant; Gmail syncs after (fully guarded).
    if (addLabels.length > 0 || removeLabels.length > 0) {
      void mirrorGmailLabelsBatch({
        threadIds: okIds,
        addLabelIds: addLabels,
        removeLabelIds: removeLabels,
        context: `bulkUpdateThreads:${act}`,
      });
    }

    // Cancel pending cadence tasks when the bulk action is a
    // terminal transition (archive or trash). Skipped for
    // unarchive/restore (the cadence re-bootstraps from the
    // engine on its next pass if the thread re-enters a working
    // state), star/unstar (orthogonal to ownership of the
    // thread), and mark_read/mark_unread (read-state has no
    // bearing on whether the thread is done).
    if (act === "archive" || act === "trash") {
      await cancelAutoTasksForThreads({
        threadIds: okIds,
        staffId: staff.id,
        context: `bulkUpdateThreads:${act}`,
      });
    }

    revalidatePath("/inbox");
    for (const id of okIds) revalidatePath(`/inbox/${id}`);
    return { ok: true, data: { updated: okIds.length } };
  } catch (err) {
    logger.error({ err, action: act, count: okIds.length }, "bulkUpdateThreads failed");
    return { ok: false, error: "Couldn't apply bulk action." };
  }
}

/**
 * openReplyDraft -- create a new email_drafts row seeded with the
 * given thread's context so the global composer can take over the
 * reply / reply-all / forward flow.
 *
 * Returns the new draft id. The client then dispatches the existing
 * 'compose-email' CustomEvent with { hydrateDraftId } and the
 * ComposerProvider bridge picks it up (the hydration path on next
 * mount re-fetches via listMyDrafts so the new draft appears in the
 * bottom-right stack).
 *
 * Auth: requireStaff + thread must be on operator's team. The
 * created draft is owned by the operator (each user has their own
 * draft list).
 *
 * Mode semantics:
 *   reply       To = original sender's address; Cc empty
 *   reply_all   To = original sender; Cc = union of original to+cc
 *               minus the inbox's own address
 *   forward     To = empty (operator picks); subject prefixed Fwd:
 *               body includes the full quoted thread
 */
export async function openReplyDraft(input: {
  threadId: string;
  /** Optional anchor message -- defaults to the latest in the thread. */
  messageId?: string | null;
  mode: "reply" | "reply_all" | "forward";
  /**
   * Optional pre-filled body text. When set, the draft's bodyHtml
   * is seeded with this string wrapped in a <div>. Used by the
   * smart-reply chips on the thread page (Haiku ROI #1) -- clicking
   * a chip opens a reply with the suggested text already pasted in
   * the editable surface, ready for the operator to edit before
   * sending.
   *
   * Plain text only (HTML is escaped). The composer is a rich-
   * text editor so paragraph/line-break behavior is handled
   * downstream by the editor's value parser.
   */
  prefillBody?: string;
}): Promise<ActionResult<{ draftId: string }>> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(input.threadId)) return { ok: false, error: "Invalid thread id." };
  if (input.messageId && !UUID_RE.test(input.messageId)) {
    return { ok: false, error: "Invalid message id." };
  }

  // Load thread + verify team scope + grab the inbox address so we
  // can omit it from Reply All's Cc list.
  const [thread] = await db
    .select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      venueId: emailThreads.venueId,
      cityCampaignId: emailThreads.cityCampaignId,
      connectedAccountId: emailThreads.staffOutreachEmailId,
      teamId: connectedAccounts.teamId,
      inboxEmail: connectedAccounts.emailAddress,
    })
    .from(emailThreads)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
    .where(eq(emailThreads.id, input.threadId))
    .limit(1);
  if (!thread || thread.teamId !== staff.teamId) {
    return { ok: false, error: "Thread not on your team." };
  }

  // Pick the anchor message. Operator-specified > latest in the thread.
  const message = input.messageId
    ? await db
        .select({
          id: emailMessages.id,
          direction: emailMessages.direction,
          fromAddress: emailMessages.fromAddress,
          fromEmailNormalized: emailMessages.fromEmailNormalized,
          fromName: emailMessages.fromName,
          toAddresses: emailMessages.toAddresses,
          ccAddresses: emailMessages.ccAddresses,
          subject: emailMessages.subject,
          bodyText: emailMessages.bodyText,
          bodyHtml: emailMessages.bodyHtml,
          sentAt: emailMessages.sentAt,
        })
        .from(emailMessages)
        .where(
          and(eq(emailMessages.threadId, input.threadId), eq(emailMessages.id, input.messageId)),
        )
        .limit(1)
        .then((r) => r[0])
    : await db
        .select({
          id: emailMessages.id,
          direction: emailMessages.direction,
          fromAddress: emailMessages.fromAddress,
          fromEmailNormalized: emailMessages.fromEmailNormalized,
          fromName: emailMessages.fromName,
          toAddresses: emailMessages.toAddresses,
          ccAddresses: emailMessages.ccAddresses,
          subject: emailMessages.subject,
          bodyText: emailMessages.bodyText,
          bodyHtml: emailMessages.bodyHtml,
          sentAt: emailMessages.sentAt,
        })
        .from(emailMessages)
        .where(eq(emailMessages.threadId, input.threadId))
        .orderBy(sql`${emailMessages.sentAt} DESC`)
        .limit(1)
        .then((r) => r[0]);
  if (!message) return { ok: false, error: "No message to reply to." };

  const inboxEmailLower = thread.inboxEmail.toLowerCase();

  // Build recipient + cc lists based on mode.
  let toList: string[];
  const ccList: string[] = [];
  if (input.mode === "forward") {
    toList = []; // operator types it in
  } else {
    // Reply / Reply All -- reply to the sender of the anchor message.
    // Skip if the anchor was outbound (replying to your own message);
    // fall back to the latest INBOUND message in the thread.
    let target = message;
    if (message.direction === "outbound") {
      const [inbound] = await db
        .select({
          id: emailMessages.id,
          direction: emailMessages.direction,
          fromAddress: emailMessages.fromAddress,
          fromEmailNormalized: emailMessages.fromEmailNormalized,
          fromName: emailMessages.fromName,
          toAddresses: emailMessages.toAddresses,
          ccAddresses: emailMessages.ccAddresses,
          subject: emailMessages.subject,
          bodyText: emailMessages.bodyText,
          bodyHtml: emailMessages.bodyHtml,
          sentAt: emailMessages.sentAt,
        })
        .from(emailMessages)
        .where(
          and(eq(emailMessages.threadId, input.threadId), eq(emailMessages.direction, "inbound")),
        )
        .orderBy(sql`${emailMessages.sentAt} DESC`)
        .limit(1);
      if (inbound) target = inbound;
    }
    // Resolve the clean reply-to address. Prefer the normalized
    // column shipped in 0083 over parsing the raw header at call
    // time -- the normalized column was filled at ingest by the
    // same parser, and the on-disk value already survived the
    // edge cases (UTF-8 in display names, comments, etc.) once.
    // Fall back to the local extractor for the rare cases the
    // backfill couldn't parse the header.
    //
    // Don't fall back to the RAW header as a last resort -- it
    // would send 'Mike Smith <mike@venue.com>' as the literal To
    // field. The Gmail send layer might accept it but the
    // composer's recipient chip parser would mis-render it. We
    // surface an explicit error instead so the operator can pick
    // the correct address manually via the composer.
    const senderEmail =
      target.fromEmailNormalized?.trim() || extractEmail(target.fromAddress) || null;
    if (!senderEmail) {
      return {
        ok: false,
        error: "Couldn't parse the sender address from the inbound message; reply manually.",
      };
    }
    toList = [senderEmail];
    if (input.mode === "reply_all") {
      const merged = [...(target.toAddresses ?? []), ...(target.ccAddresses ?? [])];
      const seen = new Set([senderEmail.toLowerCase(), inboxEmailLower]);
      for (const raw of merged) {
        const e = extractEmail(raw) ?? raw;
        const lower = e.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        ccList.push(e);
      }
    }
  }

  // Subject prefix.
  const originalSubject = message.subject ?? thread.subject ?? "(no subject)";
  const subjectPrefix = input.mode === "forward" ? "Fwd: " : "Re: ";
  const subject = /^\s*(re|fwd):/i.test(originalSubject)
    ? originalSubject
    : `${subjectPrefix}${originalSubject}`;

  // Quoted body. Format mirrors Gmail's reply quote header.
  // Stored in quotedHtml separately from bodyText/bodyHtml so the
  // composer can render the editable surface clean (just the
  // operator's cursor) with the quote behind a collapsible "..."
  // chip below. compose-send-impl concatenates on send so the
  // recipient still sees the quote regardless of whether the
  // operator expanded it. See migration 0065.
  const quoteHeader = `On ${message.sentAt.toLocaleString("en-US")}, ${message.fromName ?? message.fromAddress} wrote:`;
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const quotedTextBody = (message.bodyText ?? "")
    .split("\n")
    .map((line: string) => escapeHtml(line))
    .join("<br>");
  // Preserve the original email's HTML formatting in the quote when we
  // have it (sanitized server-side) -- replying was flattening rich HTML
  // to plain text. Fall back to the escaped plain-text rendering.
  const quotedInner =
    (message.bodyHtml ? sanitizeEmailHtml(message.bodyHtml) : null) ?? quotedTextBody;
  const quotedHtml = `<div class="gmail_quote"><div class="gmail_attr">${escapeHtml(quoteHeader)}</div><blockquote class="gmail_quote_body" style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">${quotedInner}</blockquote></div>`;
  // bodyText keeps the legacy quoted lines so plain-text-only mail
  // clients still see context. The composer reads bodyHtml as the
  // source of truth for the editable surface.
  const quotedLines = (message.bodyText ?? "")
    .split("\n")
    .map((line: string) => `> ${line}`)
    .join("\n");
  const bodyText = `\n\n${quoteHeader}\n${quotedLines}`;

  // Create the draft. ID generated server-side; client passes it
  // through to the composer hydration path.
  const draftId = crypto.randomUUID();
  // When a smart-reply chip was clicked, seed the editable HTML
  // surface with the suggested body. Escape to prevent HTML
  // injection from the model output; wrap each line in <p> so
  // the rich-text editor reads it as proper paragraphs.
  const prefilledHtml = (() => {
    const raw = input.prefillBody?.trim();
    if (!raw) return null;
    const paragraphs = raw
      .split(/\n\s*\n/)
      .map((p) =>
        p
          .split("\n")
          .map((line) => escapeHtml(line))
          .join("<br>"),
      )
      .map((p) => `<p>${p}</p>`)
      .join("");
    return paragraphs;
  })();
  try {
    await db.insert(emailDrafts).values({
      id: draftId,
      ownerUserId: staff.id,
      teamId: staff.teamId,
      connectedAccountId: thread.connectedAccountId,
      toAddresses: toList,
      ccAddresses: ccList,
      bccAddresses: [],
      subject,
      bodyText: prefilledHtml ? `${input.prefillBody}${bodyText}` : bodyText,
      bodyHtml: prefilledHtml,
      venueId: thread.venueId,
      cityCampaignId: thread.cityCampaignId,
      attachments: [],
      mode: input.mode,
      replyToThreadId: input.threadId,
      replyToMessageId: message.id,
      quotedHtml,
    });
    revalidatePath(`/inbox/${input.threadId}`);
    return { ok: true, data: { draftId } };
  } catch (err) {
    const op = newOpError("inbox.openReplyDraft");
    op.log(err, { threadId: input.threadId, mode: input.mode });
    return { ok: false, error: "Couldn't open reply.", code: op.code };
  }
}

// extractEmail used to be an inline regex helper duplicated across
// inbox/_actions.ts + inbox/_attach-venue-action.ts. The shared
// implementation in lib/email-address.ts has stricter parsing
// (quoted display names, comma-aware splits, RFC-style edge cases).
// Local function name preserved to minimize call-site churn.
function extractEmail(headerVal: string): string | null {
  return extractEmailAddress(headerVal);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Audit-context wrapper retained from earlier; we keep using it where the
// DB requires it. For email_messages we side-step it because the table
// has no audit columns by design (it's an immutable ledger).
void withAuditContext;

/**
 * setThreadClassification -- manual override of the triage classification.
 * Once an operator sets one explicitly, the Gmail poller's auto-update
 * guard (only-when-unclassified) protects this choice from getting
 * clobbered by a later inbound message.
 */
export async function setThreadClassification(
  threadId: string,
  classification:
    | "interested"
    | "warm"
    | "confirmed"
    | "question"
    | "callback_requested"
    | "decline"
    | "unsubscribe"
    | "auto_reply"
    | "spam"
    | "unclassified",
): Promise<ActionResult<{ ok: true }>> {
  const { staff } = await requireStaff();
  try {
    // Set the operator-confirmed classification AND clear any
    // pending AI suggestion in the same statement -- the
    // suggestion pill is supposed to disappear the moment the
    // operator either confirms or overrides. Phase A.1.
    await db.execute(sql`
      UPDATE email_threads
      SET classification = ${classification}::reply_classification,
          suggested_classification = NULL,
          suggested_classification_confidence = NULL,
          suggested_classification_at = NULL,
          updated_at = NOW(),
          updated_by = ${staff.id}
      WHERE id = ${threadId}
    `);
    publishRealtime({
      table: "email_threads",
      id: threadId,
      type: "update",
      byStaffId: staff.id,
      byStaffName: staff.displayName,
    });
    revalidatePath("/inbox");
    return { ok: true, data: { ok: true } };
  } catch (err) {
    logger.error({ err, threadId, classification }, "setThreadClassification failed");
    return { ok: false, error: "Couldn't update classification." };
  }
}

/**
 * backfillThreadClassifications -- re-runs the triage classifier across
 * every thread that's currently unclassified, using the latest inbound
 * message in each thread as the signal.
 *
 * Admin-only -- meant for one-shot cleanup after the classifier ships or
 * after a rule update. Caps at 500 threads per run to avoid hammering
 * the DB; re-run to keep going if there are more.
 */
export async function backfillThreadClassifications(): Promise<
  ActionResult<{ updated: number; remaining: number }>
> {
  const { staff } = await requireStaff();
  if (!hasMinimumRole(staff, "admin")) {
    return { ok: false, error: "Only admins can run the classifier backfill." };
  }

  const { classifyInboundEmail } = await import("@/lib/triage-classifier");

  // Pull up to 500 threads that are still unclassified, joined with
  // their latest inbound message.
  const rows = await db.execute<{
    thread_id: string;
    subject: string | null;
    body_text: string | null;
    from_address: string;
  }>(sql`
    WITH latest_inbound AS (
      SELECT DISTINCT ON (thread_id)
        thread_id, subject, body_text, from_address
      FROM email_messages
      WHERE direction = 'inbound'
      ORDER BY thread_id, sent_at DESC
    )
    SELECT t.id AS thread_id, li.subject, li.body_text, li.from_address
    FROM email_threads t
    JOIN latest_inbound li ON li.thread_id = t.id
    WHERE t.classification = 'unclassified'
    LIMIT 500
  `);
  type Row = {
    thread_id: string;
    subject: string | null;
    body_text: string | null;
    from_address: string;
  };
  const list: Row[] = Array.isArray(rows)
    ? (rows as unknown as Row[])
    : ((rows as unknown as { rows: Row[] }).rows ?? []);

  let updated = 0;
  for (const r of list) {
    const result = classifyInboundEmail({
      subject: r.subject,
      bodyText: r.body_text,
      fromAddress: r.from_address,
    });
    if (result.classification === "unclassified") continue;
    try {
      await db.execute(sql`
        UPDATE email_threads
        SET classification = ${result.classification}::reply_classification,
            updated_at = NOW(),
            updated_by = ${staff.id}
        WHERE id = ${r.thread_id}
          AND classification = 'unclassified'
      `);
      updated++;
    } catch (err) {
      logger.warn({ err, threadId: r.thread_id }, "backfill update failed");
    }
  }

  // Count what's still left
  const remainingRows = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM email_threads
    WHERE classification = 'unclassified'
  `);
  const remainingList = Array.isArray(remainingRows)
    ? (remainingRows as unknown as Array<{ n: number }>)
    : ((remainingRows as unknown as { rows: Array<{ n: number }> }).rows ?? []);
  const remaining = remainingList[0]?.n ?? 0;

  revalidatePath("/inbox");
  return { ok: true, data: { updated, remaining } };
}

// =========================================================================
// Team label actions -- apply / remove a label on a thread.
// =========================================================================

/**
 * List the team's labels -- small reader used by the composer's
 * three-dot menu to populate the Apply Labels submenu without
 * requiring the page-level data prop.
 */
export async function listTeamLabelsAction(): Promise<
  ActionResult<Array<{ id: string; name: string; color: string | null }>>
> {
  const { staff } = await requireStaff();
  const rows = await listTeamLabels(staff.teamId);
  return {
    ok: true,
    data: rows.map((r) => ({ id: r.id, name: r.name, color: r.color })),
  };
}

/**
 * List the labels currently applied to a thread. Same scope as
 * applyLabelToThreadAction -- team-bound via the thread's join.
 */
export async function listThreadLabelsAction(
  threadId: string,
): Promise<ActionResult<Array<{ id: string; name: string; color: string | null }>>> {
  await requireStaff();
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };
  const rows = await listThreadLabels(threadId);
  return {
    ok: true,
    data: rows.map((r) => ({ id: r.id, name: r.name, color: r.color })),
  };
}

/**
 * Apply a team_label to a thread. Validates the label belongs to the
 * current user's team. Mirrors to Gmail asynchronously inside
 * applyLabelToThread (the dashboard is the source of truth).
 */
export async function applyLabelToThreadAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ threadId: string; labelId: string }>> {
  const { staff } = await requireStaff();
  const threadId = String(formData.get("threadId") ?? "");
  const teamLabelId = String(formData.get("teamLabelId") ?? "");
  if (!threadId || !teamLabelId) {
    return { ok: false, error: "threadId + teamLabelId required" };
  }

  // Defense in depth: confirm the label is on the user's team.
  const labelRow = await db
    .select({ teamId: teamLabels.teamId })
    .from(teamLabels)
    .where(eq(teamLabels.id, teamLabelId))
    .limit(1);
  if (!labelRow[0] || labelRow[0].teamId !== staff.teamId) {
    return { ok: false, error: "Label not found." };
  }

  // Confirm the thread is on the user's team (via connected_accounts).
  const threadRow = await db
    .select({ teamId: staffOutreachEmails.teamId })
    .from(emailThreads)
    .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, emailThreads.staffOutreachEmailId))
    .where(eq(emailThreads.id, threadId))
    .limit(1);
  if (!threadRow[0] || threadRow[0].teamId !== staff.teamId) {
    return { ok: false, error: "Thread not found." };
  }

  await applyLabelToThread({
    threadId,
    teamLabelId,
    appliedBy: staff.id,
    via: "manual",
  });
  revalidatePath(`/inbox/${threadId}`);
  revalidatePath("/inbox");
  return { ok: true, data: { threadId, labelId: teamLabelId } };
}

export async function removeLabelFromThreadAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ threadId: string; labelId: string }>> {
  const { staff } = await requireStaff();
  const threadId = String(formData.get("threadId") ?? "");
  const teamLabelId = String(formData.get("teamLabelId") ?? "");
  if (!threadId || !teamLabelId) {
    return { ok: false, error: "threadId + teamLabelId required" };
  }

  // Same team checks as apply.
  const threadRow = await db
    .select({ teamId: staffOutreachEmails.teamId })
    .from(emailThreads)
    .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, emailThreads.staffOutreachEmailId))
    .where(eq(emailThreads.id, threadId))
    .limit(1);
  if (!threadRow[0] || threadRow[0].teamId !== staff.teamId) {
    return { ok: false, error: "Thread not found." };
  }

  await removeLabelFromThread({ threadId, teamLabelId });
  revalidatePath(`/inbox/${threadId}`);
  revalidatePath("/inbox");
  return { ok: true, data: { threadId, labelId: teamLabelId } };
}

// =========================================================================
// Gmail label actions (apply / remove directly via Gmail API).
//
// Distinct from the team-label actions above: these apply a Gmail-side
// label to the thread and mirror the change to the local
// email_messages.gmail_labels array. The team-label namespace isn't
// touched.
// =========================================================================

export async function applyGmailLabelToThreadAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ threadId: string; gmailLabelId: string }>> {
  const { staff } = await requireStaff();
  const threadId = String(formData.get("threadId") ?? "");
  const gmailLabelId = String(formData.get("gmailLabelId") ?? "");
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };
  if (!gmailLabelId) return { ok: false, error: "Missing gmailLabelId." };

  // Team scope: validate the thread belongs to the operator's team.
  const [row] = await db
    .select({ teamId: staffOutreachEmails.teamId })
    .from(emailThreads)
    .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, emailThreads.staffOutreachEmailId))
    .where(eq(emailThreads.id, threadId))
    .limit(1);
  if (!row || row.teamId !== staff.teamId) {
    return { ok: false, error: "Thread not on your team." };
  }

  try {
    await applyGmailLabelToThread({ threadId, gmailLabelId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Gmail rejected the change.";
    logger.warn({ err, threadId, gmailLabelId }, "applyGmailLabelToThreadAction failed");
    return { ok: false, error: msg };
  }

  revalidatePath(`/inbox/${threadId}`);
  revalidatePath("/inbox");
  return { ok: true, data: { threadId, gmailLabelId } };
}

export async function removeGmailLabelFromThreadAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ threadId: string; gmailLabelId: string }>> {
  const { staff } = await requireStaff();
  const threadId = String(formData.get("threadId") ?? "");
  const gmailLabelId = String(formData.get("gmailLabelId") ?? "");
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };
  if (!gmailLabelId) return { ok: false, error: "Missing gmailLabelId." };

  const [row] = await db
    .select({ teamId: staffOutreachEmails.teamId })
    .from(emailThreads)
    .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, emailThreads.staffOutreachEmailId))
    .where(eq(emailThreads.id, threadId))
    .limit(1);
  if (!row || row.teamId !== staff.teamId) {
    return { ok: false, error: "Thread not on your team." };
  }

  try {
    await removeGmailLabelFromThread({ threadId, gmailLabelId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Gmail rejected the change.";
    logger.warn({ err, threadId, gmailLabelId }, "removeGmailLabelFromThreadAction failed");
    return { ok: false, error: msg };
  }

  revalidatePath(`/inbox/${threadId}`);
  revalidatePath("/inbox");
  return { ok: true, data: { threadId, gmailLabelId } };
}

/**
 * List the Gmail labels picker can offer for a thread. Scoped to
 * the thread's connected_account so labels from a different account
 * don't accidentally appear.
 */
export async function listGmailLabelsForThreadAction(threadId: string): Promise<
  ActionResult<
    Array<{
      id: string;
      gmailLabelId: string;
      name: string;
      backgroundColor: string | null;
      textColor: string | null;
    }>
  >
> {
  await requireStaff();
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };
  const labels = await listGmailLabelsForThread(threadId);
  return { ok: true, data: labels };
}

/**
 * Create a new Gmail label on the connected account that receives
 * this thread, then apply it. Two-phase: createGmailLabelForAccount
 * does the Gmail API + cache write; applyGmailLabelToThread mirrors
 * the new label onto the thread.
 *
 * Color validation: the lib helper rejects non-palette pairs before
 * the network call, so the error message comes back clean for the
 * picker to surface inline.
 */
export async function createAndApplyGmailLabelAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ threadId: string; gmailLabelId: string; name: string }>> {
  const { staff } = await requireStaff();
  const threadId = String(formData.get("threadId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const backgroundColor = (formData.get("backgroundColor") as string | null) || null;
  const textColor = (formData.get("textColor") as string | null) || null;

  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };
  if (!name) return { ok: false, error: "Label name is required." };

  // Resolve the thread's connected account + verify team scope.
  const [row] = await db
    .select({
      teamId: staffOutreachEmails.teamId,
      connectedAccountId: emailThreads.staffOutreachEmailId,
    })
    .from(emailThreads)
    .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, emailThreads.staffOutreachEmailId))
    .where(eq(emailThreads.id, threadId))
    .limit(1);
  if (!row || row.teamId !== staff.teamId) {
    return { ok: false, error: "Thread not on your team." };
  }
  if (!row.connectedAccountId) {
    return { ok: false, error: "Thread has no connected account." };
  }

  try {
    const { gmailLabelId } = await createGmailLabelForAccount({
      connectedAccountId: row.connectedAccountId,
      name,
      backgroundColor,
      textColor,
    });
    // Auto-apply the new label to the current thread.
    await applyGmailLabelToThread({ threadId, gmailLabelId });
    revalidatePath(`/inbox/${threadId}`);
    revalidatePath("/inbox");
    return { ok: true, data: { threadId, gmailLabelId, name } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Gmail rejected the change.";
    logger.warn({ err, threadId, name }, "createAndApplyGmailLabelAction failed");
    return { ok: false, error: msg };
  }
}

/**
 * AI-assisted reply drafter -- wraps lib/ai-reply.draftReply in a
 * server-action contract the popout composer can call from the client.
 *
 * Always requires staff auth (via the underlying loader). Returns
 * either { ok: true, body } or { ok: false, message }. The UI
 * shows the failure message inline; the most common case is
 * "ANTHROPIC_API_KEY not set" when the operator hasn't activated
 * the AI integration on the server yet.
 */
export async function draftAiReplyAction(
  threadId: string,
): Promise<ActionResult<{ body: string }>> {
  await requireStaff();
  const result = await draftReply({ threadId });
  if (!result.ok) {
    return { ok: false, error: result.message };
  }
  return { ok: true, data: result.data };
}

/**
 * Assign or unassign a thread to a team member.
 *
 * Team-scoped: only members of the thread's owning team can be
 * assigned (we re-validate the staff id against the team). Passing
 * an empty assignedStaffId unassigns. The audit log captures the
 * change via withAuditContext + the existing audit trigger.
 */
const assignmentSchema = z.object({
  threadId: z.string().uuid(),
  assignedStaffId: z
    .string()
    .uuid()
    .or(z.literal(""))
    .nullable()
    .transform((v) => (v === "" || v === null ? null : v)),
});

export async function setThreadAssignment(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ ok: true }>> {
  const { staff } = await requireStaff();
  const parsed = assignmentSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, error: "Invalid assignment." };

  const { threadId, assignedStaffId } = parsed.data;

  // Team-scope: ensure the thread is on the operator's team AND
  // (if assigning) the staffId is on the same team. One join query
  // covers both.
  if (assignedStaffId) {
    const { users } = await import("@/db/schema");
    const [target] = await db
      .select({ teamId: staffOutreachEmails.teamId })
      .from(emailThreads)
      .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, emailThreads.staffOutreachEmailId))
      .where(eq(emailThreads.id, threadId))
      .limit(1);
    if (!target || target.teamId !== staff.teamId) {
      return { ok: false, error: "Thread not on your team." };
    }
    const [assignee] = await db
      .select({ teamId: users.teamId })
      .from(users)
      .where(eq(users.id, assignedStaffId))
      .limit(1);
    if (!assignee || assignee.teamId !== staff.teamId) {
      return { ok: false, error: "Assignee is not on this team." };
    }
  }

  try {
    await withAuditContext(staff.id, async (tx) => {
      await tx
        .update(emailThreads)
        .set({ assignedStaffId, updatedBy: staff.id })
        .where(eq(emailThreads.id, threadId));
    });
    revalidatePath(`/inbox/${threadId}`);
    revalidatePath("/inbox");
    return { ok: true, data: { ok: true } };
  } catch (err) {
    logger.error({ err, threadId }, "setThreadAssignment failed");
    return { ok: false, error: "Couldn't update assignment." };
  }
}

/**
 * List every team member, with display name + email. Used by the
 * AssignmentPicker dropdown on /inbox/<thread>.
 */
export async function listTeamMembersForAssignment(): Promise<
  Array<{ id: string; displayName: string | null; primaryEmail: string }>
> {
  const { staff } = await requireStaff();
  const { users } = await import("@/db/schema");
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      primaryEmail: users.primaryEmail,
    })
    .from(users)
    .where(eq(users.teamId, staff.teamId))
    .orderBy(users.displayName);
  return rows;
}
