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
import { sanitizeEmailHtml } from "@/lib/email-sanitize";
import { type GmailAttachment, sendGmailMessage } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { preflightSend, recordSendEvent } from "@/lib/send-cap";
import { type DuplicateWarning, describeBlock, runSendSafety } from "@/lib/send-safety";
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
  // Recipients — `to`/`cc`/`bcc` arrive as comma-separated strings
  // built by sendDraft from the draft's array columns. Split, trim,
  // dedupe, validate. `to` requires at least one address; cc/bcc are
  // optional empty-by-default arrays.
  //
  // Validation matches the previous single-recipient regex applied
  // per address. Any malformed entry rejects the entire send with a
  // pointed error so the operator can fix the bad address.
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  function parseRecipientList(raw: string): string[] {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const toList = parseRecipientList(String(formData.get("to") ?? ""));
  const ccList = parseRecipientList(String(formData.get("cc") ?? ""));
  const bccList = parseRecipientList(String(formData.get("bcc") ?? ""));
  // Keep the legacy `to` (first address) for downstream code that
  // still uses a single primary recipient — duplicate prevention,
  // venue-link lookup, recordSendEvent's recipient column. The full
  // list goes to sendGmailMessage as the actual To header.
  const to = toList[0] ?? "";
  const subject = String(formData.get("subject") ?? "").trim();
  // Plain-text body the operator typed. May be empty if the composer
  // was used in pure-HTML mode (rare today — the rich editor mirrors
  // both — but defensive). Used as the multipart/alternative text part.
  const body = String(formData.get("body") ?? "");
  // Rich HTML body the operator composed in the editor. When present,
  // this is the canonical message body — sendGmailMessage sends it as
  // the text/html part of multipart/alternative.
  //
  // PRIOR BUG (pre-this-commit): the function ignored `bodyHtml` from
  // the form and synthesized HTML by escape+wrap on `body` (the
  // plain-text version). Rich formatting in the composer (bold,
  // italic, links, lists, colors, signature HTML) was destroyed at
  // send time. Recipients received text-rendered-as-HTML with literal
  // <p> tags around escaped content.
  const bodyHtmlFromForm = String(formData.get("bodyHtml") ?? "");
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
  if (toList.length === 0) {
    return { ok: false, error: "Add at least one recipient." };
  }
  // Validate every To/Cc/Bcc address. Returns the first bad one
  // for a pointed error message; "addr1, addr2@bad" is more
  // actionable than "Enter a valid address."
  const allRecipients: Array<{ addr: string; field: "To" | "Cc" | "Bcc" }> = [
    ...toList.map((addr) => ({ addr, field: "To" as const })),
    ...ccList.map((addr) => ({ addr, field: "Cc" as const })),
    ...bccList.map((addr) => ({ addr, field: "Bcc" as const })),
  ];
  for (const { addr, field } of allRecipients) {
    if (!EMAIL_RE.test(addr)) {
      return { ok: false, error: `${field} address looks invalid: ${addr}` };
    }
  }
  if (!subject) return { ok: false, error: "Subject is required." };
  // Body is "empty" only when BOTH the plain text and the HTML
  // (after stripping tags) are blank. The composer fills both
  // halves but pure-HTML payloads (e.g. an AI draft inserted as
  // HTML) shouldn't be rejected just because the text mirror is
  // momentarily empty.
  if (!body.trim() && !bodyHtmlFromForm.replace(/<[^>]*>/g, "").trim()) {
    return { ok: false, error: "Message body is empty." };
  }

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
    // Compose an error message that names the worst-case warning
    // first. Recent-decline reads stronger than duplicate ("declined
    // 12 days ago" demands more thought than "open thread exists"),
    // so we lead with it when present.
    const declineWarning = safety.warnings.find((w) => w.kind === "recent_decline");
    const duplicateCount = safety.warnings.filter((w) => w.kind === "duplicate").length;
    let message: string;
    if (declineWarning && declineWarning.kind === "recent_decline") {
      const eventBit = declineWarning.eventLabel ? ` (${declineWarning.eventLabel})` : "";
      message = `${declineWarning.venueName} declined ${declineWarning.daysAgo} day${declineWarning.daysAgo === 1 ? "" : "s"} ago${eventBit}. Continue anyway?`;
    } else {
      message = `Possible duplicate outreach (${duplicateCount} open thread${duplicateCount === 1 ? "" : "s"} already to this address).`;
    }
    // Keep duplicateWarnings populated with just the duplicate-kind
    // entries for backwards compatibility with existing UI code; new
    // UI can read safetyWarnings to also surface the decline card.
    const duplicates = safety.warnings.filter((w): w is DuplicateWarning => w.kind === "duplicate");
    return {
      ok: false,
      error: message,
      duplicateWarnings: duplicates,
      safetyWarnings: safety.warnings,
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

  // Build the outbound HTML body.
  //
  // Source priority:
  //   1. `bodyHtml` from the composer — the canonical rich payload
  //      (bold/italic/links/lists/colors/signature). Used as-is
  //      after sanitization.
  //   2. Fallback: synthesize light HTML from the plain-text body
  //      by escape+wrap (paragraph splits on blank lines, <br> for
  //      single newlines). Used when the form lacks a bodyHtml field
  //      (legacy cron paths, internal callers that only know
  //      plain text).
  //
  // Either source goes through sanitizeEmailHtml so XSS / unsafe
  // script tags / on*=  handlers / javascript: hrefs never reach the
  // wire OR the email_messages.body_html column. The sanitizer
  // returns null on empty/blank input — we fall back to the
  // synthesized version in that case.
  const synthesizedHtml = body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const rawHtml = bodyHtmlFromForm.trim().length > 0 ? bodyHtmlFromForm : synthesizedHtml;
  const htmlBody = sanitizeEmailHtml(rawHtml) ?? synthesizedHtml;

  // 140-char snippet for thread + message list rows. Prefers the
  // plain-text body when present; falls back to a tag-stripped
  // version of the HTML so HTML-only payloads (rare, but possible
  // when the composer sends pure markup) still get a sensible
  // preview instead of an empty string.
  const derivedSnippet = (body.trim().length > 0 ? body : htmlBody.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

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
      to: toList,
      cc: ccList.length > 0 ? ccList : undefined,
      bcc: bccList.length > 0 ? bccList : undefined,
      subject,
      htmlBody,
      // textBody falls back to a strip of the HTML when `body` is
      // blank but bodyHtml was provided (HTML-only payloads). Keeps
      // the multipart text part meaningful for plain-text clients.
      textBody: body.trim().length > 0 ? body : htmlBody.replace(/<[^>]*>/g, "").trim(),
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
          snippet: derivedSnippet,
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
          snippet: derivedSnippet,
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
      // Store the full multi-recipient lists. PRIOR BUG: this row
      // only persisted [to] (the first recipient), so secondary To
      // addresses and any Cc/Bcc the operator added were invisible
      // in the engine even though Gmail actually delivered to them.
      // The schema columns are arrays — we just weren't using them.
      toAddresses: toList,
      ccAddresses: ccList,
      bccAddresses: bccList,
      // Normalized columns — see lib/email-address.ts + 0083 migration.
      // For outbound the raw and normalized are the same: the operator
      // typed clean addresses (validated by EMAIL_RE before this call)
      // and the From is the inbox's own clean email address. The poll
      // worker mirror of this same message will populate identical
      // values when Gmail eventually surfaces it back via the API.
      fromEmailNormalized: inbox.email.toLowerCase(),
      toEmailsNormalized: toList.map((s) => s.toLowerCase()),
      ccEmailsNormalized: ccList.map((s) => s.toLowerCase()),
      bccEmailsNormalized: bccList.map((s) => s.toLowerCase()),
      subject,
      bodyText: body,
      bodyHtml: htmlBody,
      snippet: derivedSnippet,
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
