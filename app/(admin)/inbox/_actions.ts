"use server";

/**
 * Inbox server actions.
 *
 * Phase: post-Gmail-poll. Now that messages ingest, operators need to
 * actually DO things in the inbox — reply, mark interested, archive,
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
  emailThreads,
  staffOutreachEmails,
  teamLabels,
} from "@/db/schema";
import { draftReply } from "@/lib/ai-reply";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { clearCadenceOnAction } from "@/lib/follow-up-cadence";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { sendGmailMessage } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { publishRealtime } from "@/lib/realtime-publish";
import { preflightSend, recordSendEvent } from "@/lib/send-cap";
import { describeBlock, runSendSafety } from "@/lib/send-safety";
import { clearStaleOnAction } from "@/lib/stale-tagger";
import { applyLabelToThread, removeLabelFromThread } from "@/lib/team-labels";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  const parsed = replySchema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { ok: false, error: "Reply text is required." };
  }
  const { threadId, body } = parsed.data;

  // Load the thread + the most recent inbound message (we'll reply to it)
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
    .where(eq(emailThreads.id, threadId))
    .limit(1);

  const row = threadRow[0];
  if (!row) return { ok: false, error: "Thread not found." };

  // Resolve the inbox + refresh token to send from.
  const inbox = await db
    .select({
      id: staffOutreachEmails.id,
      email: staffOutreachEmails.emailAddress,
      token: staffOutreachEmails.gmailOauthRefreshToken,
    })
    .from(staffOutreachEmails)
    .where(eq(staffOutreachEmails.id, row.thread.staffOutreachEmailId))
    .limit(1);

  const senderInbox = inbox[0];
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
    to: recipient,
    excludeThreadId: threadId,
    venueId: row.thread.venueId ?? null,
  });
  if (!safety.ok) {
    return { ok: false, error: describeBlock(safety.block) };
  }
  const ackDuplicates = String(formData.get("ackDuplicates") ?? "") === "1";
  if (safety.warnings.length > 0 && !ackDuplicates) {
    return {
      ok: false,
      error: `Possible duplicate outreach (${safety.warnings.length} other open thread${safety.warnings.length === 1 ? "" : "s"} to this address). Re-send to confirm.`,
    };
  }

  // Build the Re: subject
  const baseSubject = row.thread.subject ?? lastInbound[0]?.subject ?? "(no subject)";
  const subject = baseSubject.toLowerCase().startsWith("re:") ? baseSubject : `Re: ${baseSubject}`;

  // Light text→HTML — paragraphs from blank lines, newlines to <br>
  const htmlBody = body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

  // Preflight cold-send cap. Replies almost always classify warm
  // (the thread has inbound history), but a reply on a thread that
  // only has outbound messages — say the operator hits Reply on
  // their own sent message — comes back cold and consumes a slot.
  // Admin override via the form's bypassCap flag.
  const bypassCap = String(formData.get("bypassCap") ?? "") === "1";
  const preflight = await preflightSend({
    connectedAccountId: senderInbox.id,
    threadId,
  });
  if (!preflight.ok) {
    if (!bypassCap || staff.role !== "admin") {
      return {
        ok: false,
        error: `Daily cold-send cap reached on ${senderInbox.email} (${preflight.usage.used} / ${preflight.usage.cap}). ${
          staff.role === "admin"
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
      textBody: body,
      threadId: row.thread.gmailThreadId,
      replyToMessageId: row.lastInboundMessageId ?? undefined,
    });
    sentId = result.id;
    sentThreadId = result.threadId;
  } catch (err) {
    logger.error({ err, threadId }, "thread reply send failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't send the reply.",
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
      subject,
      bodyText: body,
      bodyHtml: htmlBody,
      snippet: body.slice(0, 140),
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
        snippet: body.slice(0, 140),
        updatedBy: staff.id,
      })
      .where(eq(emailThreads.id, threadId));
  } catch (err) {
    logger.error({ err, threadId }, "thread reply DB write failed AFTER sending Gmail");
    // The message went out — surface a soft warning rather than failing.
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
    });
  } catch (err) {
    logger.error({ err, threadId }, "sendThreadReply: recordSendEvent failed");
  }

  // Operator action — clear stale + cadence immediately rather than
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
// Mark thread read — fired client-side when a thread is opened
// =========================================================================

export async function markThreadRead(threadId: string): Promise<ActionResult<{ ok: true }>> {
  const { staff } = await requireStaff();
  const parsed = uuid.safeParse(threadId);
  if (!parsed.success) return { ok: false, error: "Invalid thread id." };

  try {
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
 * markThreadUnread — counterpart to markThreadRead. Sets unread_count
 * to 1 so the thread re-surfaces in unread filters + the row badge
 * comes back. Doesn't touch email_messages.read_at — the per-message
 * read state is separate and tracking which specific message to
 * re-flag isn't a useful distinction at the operator level.
 */
export async function markThreadUnread(threadId: string): Promise<ActionResult<{ ok: true }>> {
  const { staff } = await requireStaff();
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Invalid thread id." };
  try {
    await db
      .update(emailThreads)
      .set({ unreadCount: 1, updatedBy: staff.id })
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
 * setThreadStar — toggle the Gmail-style star on a thread. Engine-side
 * only in v1; a future cron can two-way sync to Gmail using the OAuth
 * creds on the connected_account.
 *
 * Auth: requireStaff + team-scoped (thread's connected account must be
 * on the operator's team). No role gating — anyone on the team can
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
 * setThreadTrash — soft-delete a thread (move to Trash) or restore it.
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
 * setThreadSnooze — snooze a thread until a future timestamp, or clear
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
 * bulkUpdateThreads — apply one of a handful of toggles to a list of
 * thread ids. Used by the inbox top toolbar when the operator has
 * selected one or more rows.
 *
 * Supported actions:
 *   star          — is_starred = true
 *   unstar        — is_starred = false
 *   trash         — deleted_at = now()
 *   restore       — deleted_at = null (un-trash)
 *   archive       — state = 'archived' + archived_at = now()
 *   mark_read     — unread_count = 0 (clears the unread badge)
 *   mark_unread   — unread_count = 1 (resurfaces the unread badge)
 *
 * Auth: requireStaff + team-scoped on every id (WHERE clause includes
 * the team_id check via the joined connected_accounts row).
 *
 * Returns the count of rows actually updated — useful for the toast
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
    case "mark_read":
      patch.unreadCount = 0;
      break;
    case "mark_unread":
      patch.unreadCount = 1;
      break;
  }

  try {
    await db.update(emailThreads).set(patch).where(inArray(emailThreads.id, okIds));
    revalidatePath("/inbox");
    for (const id of okIds) revalidatePath(`/inbox/${id}`);
    return { ok: true, data: { updated: okIds.length } };
  } catch (err) {
    logger.error({ err, action: act, count: okIds.length }, "bulkUpdateThreads failed");
    return { ok: false, error: "Couldn't apply bulk action." };
  }
}

/**
 * openReplyDraft — create a new email_drafts row seeded with the
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
  /** Optional anchor message — defaults to the latest in the thread. */
  messageId?: string | null;
  mode: "reply" | "reply_all" | "forward";
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
          fromName: emailMessages.fromName,
          toAddresses: emailMessages.toAddresses,
          ccAddresses: emailMessages.ccAddresses,
          subject: emailMessages.subject,
          bodyText: emailMessages.bodyText,
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
          fromName: emailMessages.fromName,
          toAddresses: emailMessages.toAddresses,
          ccAddresses: emailMessages.ccAddresses,
          subject: emailMessages.subject,
          bodyText: emailMessages.bodyText,
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
    // Reply / Reply All — reply to the sender of the anchor message.
    // Skip if the anchor was outbound (replying to your own message);
    // fall back to the latest INBOUND message in the thread.
    let target = message;
    if (message.direction === "outbound") {
      const [inbound] = await db
        .select({
          id: emailMessages.id,
          direction: emailMessages.direction,
          fromAddress: emailMessages.fromAddress,
          fromName: emailMessages.fromName,
          toAddresses: emailMessages.toAddresses,
          ccAddresses: emailMessages.ccAddresses,
          subject: emailMessages.subject,
          bodyText: emailMessages.bodyText,
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
    const senderEmail = extractEmail(target.fromAddress) ?? target.fromAddress;
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
  const quoteHeader = `On ${message.sentAt.toLocaleString()}, ${message.fromName ?? message.fromAddress} wrote:`;
  const quotedLines = (message.bodyText ?? "")
    .split("\n")
    .map((line: string) => `> ${line}`)
    .join("\n");
  const bodyText = `\n\n${quoteHeader}\n${quotedLines}`;

  // Create the draft. ID generated server-side; client passes it
  // through to the composer hydration path.
  const draftId = crypto.randomUUID();
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
      bodyText,
      bodyHtml: null,
      venueId: thread.venueId,
      cityCampaignId: thread.cityCampaignId,
      attachments: [],
      mode: input.mode,
      replyToThreadId: input.threadId,
      replyToMessageId: message.id,
    });
    revalidatePath(`/inbox/${input.threadId}`);
    return { ok: true, data: { draftId } };
  } catch (err) {
    logger.error({ err, threadId: input.threadId, mode: input.mode }, "openReplyDraft failed");
    return { ok: false, error: "Couldn't open reply." };
  }
}

function extractEmail(headerVal: string): string | null {
  const m = headerVal.match(/<([^>]+)>/) ?? headerVal.match(/([\w.\-+]+@[\w.\-]+)/);
  return m?.[1]?.toLowerCase() ?? null;
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
 * setThreadClassification — manual override of the triage classification.
 * Once an operator sets one explicitly, the Gmail poller's auto-update
 * guard (only-when-unclassified) protects this choice from getting
 * clobbered by a later inbound message.
 */
export async function setThreadClassification(
  threadId: string,
  classification:
    | "interested"
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
    await db.execute(sql`
      UPDATE email_threads
      SET classification = ${classification}::reply_classification,
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
 * backfillThreadClassifications — re-runs the triage classifier across
 * every thread that's currently unclassified, using the latest inbound
 * message in each thread as the signal.
 *
 * Admin-only — meant for one-shot cleanup after the classifier ships or
 * after a rule update. Caps at 500 threads per run to avoid hammering
 * the DB; re-run to keep going if there are more.
 */
export async function backfillThreadClassifications(): Promise<
  ActionResult<{ updated: number; remaining: number }>
> {
  const { staff } = await requireStaff();
  if (staff.role !== "admin") {
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
// Team label actions — apply / remove a label on a thread.
// =========================================================================

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

/**
 * AI-assisted reply drafter — wraps lib/ai-reply.draftReply in a
 * server-action contract the ReplyComposer can call from the client.
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
