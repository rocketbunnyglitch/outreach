/**
 * empty-body-backfill.ts -- repair email_messages rows whose body
 * fields are empty because the original ingest hit the
 * attachmentId-not-data bug (fixed in commit 38b15f6).
 *
 * Why a dedicated backfill instead of deep-resync
 * -----------------------------------------------
 *
 * Deep-resync (d3ae569) re-fetches an entire days-back window from
 * Gmail, dedupes by gmail_message_id, and re-runs ingest. That
 * works for the empty-body case but burns Gmail API quota on every
 * message in the window, not just the broken ones. For a busy
 * inbox six months of deep-resync is thousands of redundant
 * fetches.
 *
 * This backfill scans email_messages for the specific symptom
 * (inbound + body_text='' + body_html IS NULL) and re-fetches ONLY
 * those messages. Two API calls per row in the worst case (the
 * messages.get + the attachments.get for the body). For a typical
 * team with a couple hundred affected Triple Seat / Eventbrite
 * notifications, that's < 1000 API calls -- well inside the daily
 * quota budget and finishes in a couple minutes.
 *
 * Selection criteria
 * ------------------
 *
 *   - direction = 'inbound'  -- outbound bodies we authored, they
 *                               were never going to be empty from
 *                               the ingest path
 *   - body_text = '' OR body_text IS NULL
 *   - body_html IS NULL      -- both halves missing = the bug
 *   - The thread isn't deleted (deleted_at IS NULL on the parent
 *     email_threads row) -- backfilling deleted rows is wasted work
 *   - The owning connected_account has a refresh token + status
 *     'connected' -- can't fetch from a disconnected account
 *
 * Safety / idempotency
 * --------------------
 *
 *   - Already-filled rows are excluded by the WHERE clause, so
 *     re-running is a no-op for messages the previous run repaired.
 *   - A row whose body still extracts empty after the re-fetch
 *     (genuinely empty email, or a message whose attachment URL is
 *     gone) is left alone with body_text='' -- the next run won't
 *     try again only because it's filtered by the empty check
 *     pre-fetch. Acceptable: the message wasn't going to give us a
 *     body anyway.
 *   - Cap per-run via opts.limit so a 10,000-row backlog doesn't
 *     all run at once. Operator can rerun until done.
 */

import "server-only";
import { connectedAccounts, emailMessages, emailThreads } from "@/db/schema";
import { db } from "@/lib/db";
import { refreshAccessToken } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { and, eq, isNull, or, sql } from "drizzle-orm";

export interface EmptyBodyBackfillResult {
  /** Total candidate rows in the team's email_messages matching the
   *  empty-body symptom. May exceed `scanned` if `limit` capped the run. */
  totalCandidates: number;
  /** Rows we actually attempted to re-fetch this run. */
  scanned: number;
  /** Rows where the re-fetch returned a non-empty body and we updated. */
  repaired: number;
  /** Rows where the re-fetch returned empty (genuinely empty email or
   *  Gmail API problem). Not counted as failures -- the row is left
   *  as-is. */
  stillEmpty: number;
  /** Rows where the Gmail API call failed (token expired, message
   *  deleted server-side, network error). Logged + skipped. */
  errors: number;
}

interface CandidateRow {
  id: string;
  gmailMessageId: string;
  accountId: string;
  refreshToken: string;
}

/**
 * Find + re-fetch up to `limit` inbound email_messages whose body
 * fields are empty. Returns a result summary suitable for surfacing
 * in the admin UI.
 *
 * teamId scoping: gates the candidate query to the operator's team
 * so an admin in team A can't trigger a backfill on team B's data.
 */
export async function backfillEmptyBodies(opts: {
  teamId: string;
  limit?: number;
}): Promise<EmptyBodyBackfillResult> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

  // First: a fast count of total candidates so the UI can show
  // "we hit the cap, X more remaining."
  const countRows = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM email_messages m
    JOIN email_threads t ON t.id = m.thread_id
    JOIN connected_accounts ca ON ca.id = m.staff_outreach_email_id
    WHERE ca.team_id = ${opts.teamId}
      AND ca.status = 'connected'
      AND ca.gmail_oauth_refresh_token IS NOT NULL
      AND t.deleted_at IS NULL
      AND m.direction = 'inbound'
      AND (m.body_text = '' OR m.body_text IS NULL)
      AND m.body_html IS NULL
  `);
  const countList = Array.isArray(countRows)
    ? (countRows as unknown as Array<{ n: number }>)
    : ((countRows as unknown as { rows: Array<{ n: number }> }).rows ?? []);
  const totalCandidates = Number(countList[0]?.n ?? 0);

  // Then: select the batch we'll actually process this run.
  // We join through the account so we have the refresh token in hand
  // and don't need a second lookup per message.
  const candidates: CandidateRow[] = await db
    .select({
      id: emailMessages.id,
      gmailMessageId: emailMessages.gmailMessageId,
      accountId: connectedAccounts.id,
      refreshToken: sql<string>`${connectedAccounts.gmailOauthRefreshToken}`,
    })
    .from(emailMessages)
    .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailMessages.staffOutreachEmailId))
    .where(
      and(
        eq(connectedAccounts.teamId, opts.teamId),
        eq(connectedAccounts.status, "connected"),
        sql`${connectedAccounts.gmailOauthRefreshToken} IS NOT NULL`,
        isNull(emailThreads.deletedAt),
        eq(emailMessages.direction, "inbound"),
        or(eq(emailMessages.bodyText, ""), isNull(emailMessages.bodyText)),
        isNull(emailMessages.bodyHtml),
      ),
    )
    .limit(limit);

  let repaired = 0;
  let stillEmpty = 0;
  let errors = 0;

  // Group by account so we refresh each access token once, not once
  // per message. A team with 4 inboxes and 200 broken messages does
  // 4 token refreshes instead of 200.
  const byAccount = new Map<string, { refreshToken: string; rows: CandidateRow[] }>();
  for (const c of candidates) {
    const entry = byAccount.get(c.accountId);
    if (entry) entry.rows.push(c);
    else byAccount.set(c.accountId, { refreshToken: c.refreshToken, rows: [c] });
  }

  for (const [accountId, { refreshToken, rows }] of byAccount) {
    let accessToken: string;
    try {
      accessToken = await refreshAccessToken(refreshToken);
    } catch (err) {
      logger.warn(
        { err, accountId, rowCount: rows.length },
        "empty-body backfill: account token refresh failed; skipping batch",
      );
      errors += rows.length;
      continue;
    }

    for (const row of rows) {
      try {
        const repairedRow = await reingestBodyForMessage({
          messageId: row.gmailMessageId,
          emailMessageId: row.id,
          accessToken,
        });
        if (repairedRow) repaired++;
        else stillEmpty++;
      } catch (err) {
        logger.warn(
          { err, accountId, messageId: row.gmailMessageId },
          "empty-body backfill: per-row re-fetch failed",
        );
        errors++;
      }
    }
  }

  logger.info(
    {
      teamId: opts.teamId,
      totalCandidates,
      scanned: candidates.length,
      repaired,
      stillEmpty,
      errors,
    },
    "empty-body backfill complete",
  );

  return {
    totalCandidates,
    scanned: candidates.length,
    repaired,
    stillEmpty,
    errors,
  };
}

/**
 * Re-fetch a single message and update its body columns if the
 * extraction now produces non-empty output. Returns true when a
 * repair occurred, false when the message remains empty after
 * re-fetch.
 *
 * Reuses the same extraction logic as the live poll path
 * (lib/gmail-poll-worker.ts) by directly importing the GmailPayload
 * shape + the attachment-aware extractors -- both now exported for
 * this use. If the live poll path changes its body-extraction
 * contract, this backfill picks up the new behavior automatically.
 */
async function reingestBodyForMessage(opts: {
  messageId: string;
  emailMessageId: string;
  accessToken: string;
}): Promise<boolean> {
  const { extractHtmlForBackfill, extractPlainTextForBackfill, gmailFetchForBackfill } =
    await import("@/lib/gmail-poll-worker");

  const msg = await gmailFetchForBackfill(
    `users/me/messages/${encodeURIComponent(opts.messageId)}?format=full`,
    opts.accessToken,
  );

  const payload = (msg as { payload?: unknown }).payload;

  const rawHtml = await extractHtmlForBackfill(
    // biome-ignore lint/suspicious/noExplicitAny: GmailPayload is private to gmail-poll-worker; the cast lets us pass it through without re-exporting the type
    payload as any,
    opts.messageId,
    opts.accessToken,
  );
  const rawText = await extractPlainTextForBackfill(
    // biome-ignore lint/suspicious/noExplicitAny: same as above
    payload as any,
    opts.messageId,
    opts.accessToken,
  );

  // Same fallback logic as the live ingest path: synthesize text
  // from HTML when only HTML is present.
  const bodyHtml = rawHtml ?? null;
  const bodyText =
    rawText.length > 0
      ? rawText
      : bodyHtml
        ? bodyHtml
            .replace(/<\/(p|div|br|li|h[1-6])>/gi, "\n")
            .replace(/<[^>]*>/g, "")
            .replace(/[ \t]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
        : "";

  // Nothing to repair -- still empty after re-fetch.
  if (bodyText.length === 0 && !bodyHtml) {
    return false;
  }

  await db
    .update(emailMessages)
    .set({ bodyText, bodyHtml })
    .where(eq(emailMessages.id, opts.emailMessageId));

  return true;
}
