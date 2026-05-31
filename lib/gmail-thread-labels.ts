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

/**
 * Currently-applied Gmail labels on a thread — distinct across every
 * message, joined to gmail_labels for the bg/text colors. Identical
 * shape to the per-thread chips on the inbox row, used by the
 * single-thread detail surface for the picker's initial state.
 */
export async function loadAppliedGmailLabelsForThread(threadId: string): Promise<
  Array<{
    gmailLabelId: string;
    name: string;
    backgroundColor: string | null;
    textColor: string | null;
  }>
> {
  const rows = await db.execute<{
    gmail_label_id: string;
    name: string;
    background_color: string | null;
    text_color: string | null;
  }>(sql`
    SELECT DISTINCT
      gl.gmail_label_id,
      gl.name,
      gl.background_color,
      gl.text_color
    FROM email_messages em
    INNER JOIN email_threads et ON et.id = em.thread_id
    INNER JOIN gmail_labels gl
      ON gl.connected_account_id = et.staff_outreach_email_id
     AND gl.gmail_label_id = ANY(em.gmail_labels)
    WHERE em.thread_id = ${threadId}::uuid
      AND gl.type = 'user'
    ORDER BY gl.name
  `);

  const list = Array.isArray(rows)
    ? (rows as unknown as Array<{
        gmail_label_id: string;
        name: string;
        background_color: string | null;
        text_color: string | null;
      }>)
    : ((
        rows as unknown as {
          rows: Array<{
            gmail_label_id: string;
            name: string;
            background_color: string | null;
            text_color: string | null;
          }>;
        }
      ).rows ?? []);

  return list.map((r) => ({
    gmailLabelId: r.gmail_label_id,
    name: r.name,
    backgroundColor: r.background_color,
    textColor: r.text_color,
  }));
}

/**
 * Create a new Gmail label on a specific connected account, then
 * cache the row in our gmail_labels table so the UI can pick it up
 * without waiting for the next poll.
 *
 * Color is optional. When provided, must be a valid Gmail palette
 * pair (validated in createGmailLabel before the network call).
 */
export async function createGmailLabelForAccount(opts: {
  connectedAccountId: string;
  name: string;
  backgroundColor?: string | null;
  textColor?: string | null;
}): Promise<{ id: string; gmailLabelId: string }> {
  const trimmed = opts.name.trim();
  if (!trimmed) throw new Error("Label name is required.");

  const [acct] = await db
    .select({ refreshToken: connectedAccounts.gmailOauthRefreshToken })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, opts.connectedAccountId))
    .limit(1);
  if (!acct?.refreshToken) {
    throw new Error("Connected account has no Gmail credentials.");
  }

  // Gmail call first — validates color + name + creates if new.
  const { createGmailLabel } = await import("@/lib/gmail");
  const result = await createGmailLabel({
    encryptedRefreshToken: acct.refreshToken,
    name: trimmed,
    backgroundColor: opts.backgroundColor ?? null,
    textColor: opts.textColor ?? null,
  });

  // Cache row in gmail_labels. ON CONFLICT updates name + colors
  // so existing rows pick up the new attributes if Gmail returned
  // an existing label id.
  const [cached] = await db
    .insert(gmailLabels)
    .values({
      connectedAccountId: opts.connectedAccountId,
      gmailLabelId: result.id,
      name: trimmed,
      type: "user",
      backgroundColor: opts.backgroundColor ?? null,
      textColor: opts.textColor ?? null,
    })
    .onConflictDoUpdate({
      target: [gmailLabels.connectedAccountId, gmailLabels.gmailLabelId],
      set: {
        name: trimmed,
        backgroundColor: opts.backgroundColor ?? null,
        textColor: opts.textColor ?? null,
        updatedAt: sql`NOW()`,
      },
    })
    .returning({ id: gmailLabels.id, gmailLabelId: gmailLabels.gmailLabelId });

  if (!cached) {
    throw new Error("Failed to cache Gmail label locally.");
  }

  logger.info(
    {
      connectedAccountId: opts.connectedAccountId,
      gmailLabelId: result.id,
      existed: result.existed,
    },
    "Created Gmail label",
  );

  return { id: cached.id, gmailLabelId: cached.gmailLabelId };
}
