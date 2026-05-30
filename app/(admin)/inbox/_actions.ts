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

import { emailMessages, emailThreads, staffOutreachEmails, teamLabels } from "@/db/schema";
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
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
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
