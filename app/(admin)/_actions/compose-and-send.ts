"use server";

/**
 * Shared "compose new email" pipeline.
 *
 * Used by:
 *   - cold-outreach table mail button (one-off venue outreach)
 *   - venue summary strip "Email" button
 *   - any future "send mail to this address" UI
 *
 * Distinct from sendThreadReply: this one CREATES a new thread (no
 * existing Gmail threadId, no in-reply-to). It still goes through
 * lib/gmail.sendGmailMessage so the message lands in the operator's
 * Sent folder and the same poll-worker / state machine picks it up
 * on the next cycle as an outbound thread.
 *
 * The send-from inbox is chosen by the user from the modal — never
 * inferred — so a multi-account user always sees which Gmail they're
 * sending from.
 */

import { connectedAccounts, emailMessages, emailThreads, users } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendGmailMessage } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { type TeamLabelSummary, applyLabelToThread, listTeamLabels } from "@/lib/team-labels";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ConnectedAccountOption {
  id: string;
  emailAddress: string;
  ownerDisplayName: string | null;
  /** "mine" if owned by current user; "team" otherwise. UI uses this
   *  to group + sort the dropdown so the user's own accounts come first. */
  scope: "mine" | "team";
  status: "connected" | "needs_reauth" | "disconnected";
}

/**
 * List every connected Gmail account on the current user's team that
 * is sendable. Sorted: mine first (alpha), then team (alpha).
 * Excludes disconnected accounts since they can't send.
 */
export async function listSendableInboxes(): Promise<ConnectedAccountOption[]> {
  const { staff } = await requireStaff();

  const rows = await db
    .select({
      id: connectedAccounts.id,
      emailAddress: connectedAccounts.emailAddress,
      ownerUserId: connectedAccounts.ownerUserId,
      status: connectedAccounts.status,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.teamId, staff.teamId));

  // Filter + classify in JS — the team's connected-accounts list is
  // small (under 20 even at full team size).
  const usable = rows.filter((r) => r.status === "connected" || r.status === "needs_reauth");

  // Fetch owner display names in one Drizzle query — tiny set, cheap.
  const ownerIds = Array.from(
    new Set(usable.map((r) => r.ownerUserId).filter(Boolean) as string[]),
  );
  const ownerRows = ownerIds.length
    ? await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, ownerIds))
    : [];

  const ownerNameMap = new Map<string, string | null>();
  for (const o of ownerRows) ownerNameMap.set(o.id, o.displayName ?? null);

  const opts: ConnectedAccountOption[] = usable.map((r) => ({
    id: r.id,
    emailAddress: r.emailAddress,
    ownerDisplayName: r.ownerUserId ? (ownerNameMap.get(r.ownerUserId) ?? null) : null,
    scope: r.ownerUserId === staff.id ? "mine" : "team",
    status: r.status as ConnectedAccountOption["status"],
  }));

  opts.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "mine" ? -1 : 1;
    return a.emailAddress.localeCompare(b.emailAddress);
  });

  return opts;
}

/**
 * Bundle the modal's lazy-load: inboxes + team labels in one
 * round trip so the compose modal doesn't have to make two calls
 * the first time it opens.
 */
export async function listComposeContext(): Promise<{
  inboxes: ConnectedAccountOption[];
  labels: TeamLabelSummary[];
}> {
  const { staff } = await requireStaff();
  const [inboxes, labels] = await Promise.all([
    listSendableInboxes(),
    listTeamLabels(staff.teamId),
  ]);
  return { inboxes, labels };
}

export type ComposeResult = { ok: true; threadId: string } | { ok: false; error: string };

/**
 * Send a brand-new email from a chosen connected inbox. Creates a
 * fresh thread row in our DB so the operator can track replies.
 *
 * Args (FormData):
 *   fromAccountId  — connected_accounts.id (must be on user's team)
 *   to             — recipient email
 *   subject        — string (non-empty)
 *   body           — plain text; converted to light HTML for the
 *                    Gmail send (paragraphs from blank-line breaks,
 *                    newlines to <br>)
 *   venueId?       — optional UUID. When set, the new thread is
 *                    attributed to that venue. When absent, thread
 *                    has venueId = null (operator can attach later).
 */
export async function composeAndSend(_prev: unknown, formData: FormData): Promise<ComposeResult> {
  const { staff } = await requireStaff();

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

  // Build light HTML.
  const htmlBody = body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

  let sent: { id: string; threadId: string };
  try {
    sent = await sendGmailMessage({
      encryptedRefreshToken: inbox.token,
      from: inbox.email,
      to,
      subject,
      htmlBody,
      textBody: body,
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
  const now = new Date();
  let threadId: string;
  try {
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
