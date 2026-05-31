import "server-only";

/**
 * Apply / remove Gmail labels DIRECTLY on a thread (vs the team-label
 * pipeline which goes through the engine's curated namespace).
 *
 * Two-way sync:
 *   - The Gmail API call (modifyGmailThreadLabels) is the source of
 *     truth — every operator-driven label change goes there first.
 *   - On success, we mirror to email_messages.gmail_labels arrays so
 *     the next page render reflects the change without waiting for
 *     the next poll cycle. Inbound changes from Gmail itself (the
 *     operator labeled a message in Gmail's web UI) come through the
 *     poll worker as before — that path is untouched.
 *
 * Why a separate module from lib/team-labels:
 *   team_labels is the engine's CURATED namespace, mirrored to Gmail
 *   on apply. Gmail labels are the operator's Gmail-side labels,
 *   applied directly. They overlap on the wire but the user model is
 *   different (operator picks a Gmail label = they want it in Gmail;
 *   operator picks a team label = they want it engine-wide).
 */

import { connectedAccounts, emailMessages, emailThreads, gmailLabels } from "@/db/schema";
import { db } from "@/lib/db";
import { modifyGmailThreadLabels } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { and, eq, sql } from "drizzle-orm";

/**
 * Resolve the (refresh token, Gmail thread id, account-scope gmail
 * label id) tuple needed to fire modifyGmailThreadLabels.
 *
 * Returns null when any piece is missing — caller handles the
 * graceful-degrade.
 */
async function resolveContext(
  threadId: string,
  gmailLabelId: string,
): Promise<{
  refreshToken: string;
  gmailThreadId: string;
  connectedAccountId: string;
  /** The Gmail-side id matching gmail_labels.gmail_label_id. The
   *  caller's gmailLabelId might be the raw Gmail id OR our internal
   *  gmail_labels.id (uuid) — we accept either by looking up both. */
  resolvedGmailLabelId: string;
} | null> {
  const [row] = await db
    .select({
      gmailThreadId: emailThreads.gmailThreadId,
      refreshToken: connectedAccounts.gmailOauthRefreshToken,
      connectedAccountId: connectedAccounts.id,
    })
    .from(emailThreads)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
    .where(eq(emailThreads.id, threadId))
    .limit(1);

  if (!row || !row.refreshToken || !row.gmailThreadId) return null;

  // Accept either the Gmail id (the string Gmail returns, e.g. "Label_42")
  // OR our internal uuid. Internal uuids are 36 chars with hyphens; Gmail
  // ids are typically prefixed strings like "Label_NN" or system constants
  // ("INBOX", "SPAM"). Try the internal lookup first since that's what
  // the UI tends to pass.
  const [labelRow] = await db
    .select({ gmailLabelId: gmailLabels.gmailLabelId })
    .from(gmailLabels)
    .where(
      and(
        eq(gmailLabels.connectedAccountId, row.connectedAccountId),
        // SQL OR: match by internal id (uuid) OR by Gmail-side id (text).
        sql`(${gmailLabels.id}::text = ${gmailLabelId} OR ${gmailLabels.gmailLabelId} = ${gmailLabelId})`,
      ),
    )
    .limit(1);

  if (!labelRow) return null;

  return {
    refreshToken: row.refreshToken,
    gmailThreadId: row.gmailThreadId,
    connectedAccountId: row.connectedAccountId,
    resolvedGmailLabelId: labelRow.gmailLabelId,
  };
}

/**
 * Apply a Gmail label to a thread. Two-phase:
 *   1. Call modifyGmailThreadLabels with addLabelIds:[gmailId] —
 *      Gmail is authoritative.
 *   2. On success, push the gmailLabelId onto each
 *      email_messages.gmail_labels array on the thread so the next
 *      page render reflects the change immediately.
 *
 * Returns { ok: true } on success or throws on Gmail API failure
 * (caller wraps in try/catch + surfaces to UI).
 */
export async function applyGmailLabelToThread(opts: {
  threadId: string;
  gmailLabelId: string;
}): Promise<{ ok: true }> {
  const ctx = await resolveContext(opts.threadId, opts.gmailLabelId);
  if (!ctx) {
    throw new Error("Could not resolve Gmail credentials or label for this thread.");
  }

  await modifyGmailThreadLabels({
    encryptedRefreshToken: ctx.refreshToken,
    gmailThreadId: ctx.gmailThreadId,
    addLabelIds: [ctx.resolvedGmailLabelId],
  });

  // Mirror to local state via array_append (de-duplicated). Postgres
  // doesn't have a native "add if not exists" for arrays, so use
  // array_remove + array_append to guarantee idempotency.
  await db
    .update(emailMessages)
    .set({
      gmailLabels: sql`array_append(array_remove(${emailMessages.gmailLabels}, ${ctx.resolvedGmailLabelId}), ${ctx.resolvedGmailLabelId})`,
    })
    .where(eq(emailMessages.threadId, opts.threadId));

  logger.info(
    { threadId: opts.threadId, gmailLabelId: ctx.resolvedGmailLabelId },
    "Applied Gmail label to thread",
  );
  return { ok: true };
}

/**
 * Remove a Gmail label from a thread. Same two-phase shape: Gmail
 * first, local mirror second.
 */
export async function removeGmailLabelFromThread(opts: {
  threadId: string;
  gmailLabelId: string;
}): Promise<{ ok: true }> {
  const ctx = await resolveContext(opts.threadId, opts.gmailLabelId);
  if (!ctx) {
    throw new Error("Could not resolve Gmail credentials or label for this thread.");
  }

  await modifyGmailThreadLabels({
    encryptedRefreshToken: ctx.refreshToken,
    gmailThreadId: ctx.gmailThreadId,
    removeLabelIds: [ctx.resolvedGmailLabelId],
  });

  await db
    .update(emailMessages)
    .set({
      gmailLabels: sql`array_remove(${emailMessages.gmailLabels}, ${ctx.resolvedGmailLabelId})`,
    })
    .where(eq(emailMessages.threadId, opts.threadId));

  logger.info(
    { threadId: opts.threadId, gmailLabelId: ctx.resolvedGmailLabelId },
    "Removed Gmail label from thread",
  );
  return { ok: true };
}

/**
 * List the Gmail labels available on the connected account that
 * receives this thread. Used to populate the label picker for the
 * thread. Returns user-type labels only (system labels like INBOX
 * shouldn't be operator-applied via this surface).
 */
export async function listGmailLabelsForThread(threadId: string): Promise<
  Array<{
    id: string;
    gmailLabelId: string;
    name: string;
    backgroundColor: string | null;
    textColor: string | null;
  }>
> {
  const [thread] = await db
    .select({ accountId: emailThreads.staffOutreachEmailId })
    .from(emailThreads)
    .where(eq(emailThreads.id, threadId))
    .limit(1);
  if (!thread?.accountId) return [];

  return await db
    .select({
      id: gmailLabels.id,
      gmailLabelId: gmailLabels.gmailLabelId,
      name: gmailLabels.name,
      backgroundColor: gmailLabels.backgroundColor,
      textColor: gmailLabels.textColor,
    })
    .from(gmailLabels)
    .where(and(eq(gmailLabels.connectedAccountId, thread.accountId), eq(gmailLabels.type, "user")))
    .orderBy(sql`lower(${gmailLabels.name})`);
}
