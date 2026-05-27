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

import { emailMessages, emailThreads, staffOutreachEmails } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import { type ActionResult, formToObject } from "@/lib/form-utils";
import { sendGmailMessage } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { publishRealtime } from "@/lib/realtime-publish";
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

  // Build the Re: subject
  const baseSubject = row.thread.subject ?? lastInbound[0]?.subject ?? "(no subject)";
  const subject = baseSubject.toLowerCase().startsWith("re:") ? baseSubject : `Re: ${baseSubject}`;

  // Light text→HTML — paragraphs from blank lines, newlines to <br>
  const htmlBody = body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

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
