import "server-only";

/**
 * Gmail SYSTEM-label mirror helpers.
 *
 * The team-scope-safe, error-logged way to push an engine-side state
 * change onto a thread's Gmail system labels. Every engine action that
 * maps to a Gmail label change has a counterpart here:
 *
 *   - star / unstar      -> add / remove "STARRED"
 *   - archive / unarchive -> remove / add "INBOX"
 *   - trash / restore     -> add / remove "TRASH"
 *   - read / unread       -> remove / add "UNREAD"
 *
 * Contract: the CALLER writes the canonical engine state first, then
 * calls one of these to mirror the decision to Gmail. The engine row
 * is the source of truth; Gmail is the mirror. A Gmail-side failure
 * (expired token, network blip, thread deleted in Gmail) is logged and
 * swallowed -- the next gmail-poll cycle reconciles. Mirroring is
 * therefore always best-effort and never throws back to the caller.
 *
 * Why a separate module from lib/gmail-thread-labels.ts:
 *   lib/gmail-thread-labels.ts handles operator-applied USER labels --
 *   it resolves a gmail_labels row (internal uuid OR Gmail id), mirrors
 *   to email_messages.gmail_labels, and throws on failure so the UI can
 *   surface it. This module handles SYSTEM labels (STARRED / INBOX /
 *   TRASH / UNREAD) that the caller names directly, does no label-id
 *   resolution, and never throws. Different user model, different
 *   failure contract -- so they stay separate.
 *
 * Why a separate module from app/(admin)/inbox/_actions.ts:
 *   _actions.ts currently carries its own inline mirrorGmailLabels /
 *   mirrorGmailLabelsBatch pair. These exports are the reusable home
 *   for that logic so future call sites (and an eventual consolidation
 *   of the inline copies) share one team-scoped, logged implementation
 *   instead of re-deriving the token + gmail_thread_id lookup.
 */

import { connectedAccounts, emailThreads } from "@/db/schema";
import { db } from "@/lib/db";
import { modifyGmailThreadLabels } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { and, eq, inArray } from "drizzle-orm";

export interface MirrorThreadLabelOptions {
  /** Gmail system-label ids to add, e.g. ["STARRED"] or ["INBOX"]. */
  addLabelIds?: string[];
  /** Gmail system-label ids to remove, e.g. ["UNREAD"] or ["TRASH"]. */
  removeLabelIds?: string[];
  /**
   * Short tag identifying the calling action (e.g. "setThreadStar"),
   * included in the warning log when a mirror fails so a noisy Gmail
   * account can be traced back to the operation that triggered it.
   */
  context: string;
  /**
   * Optional team-scope guard -- DEFENSE-IN-DEPTH only, NOT the primary
   * ownership check. Callers must still validate that the thread is on
   * the operator's team before invoking the mirror, exactly as the
   * inline _actions.ts callers do; this guard is a backstop against a
   * stale or forged thread id slipping through.
   *
   * When omitted, behavior is identical to that inline pattern: the
   * lookup keys on thread id alone with no team filter (correct for
   * per-inbox system callers such as the poll worker, which have no
   * team in scope -- so this is intentionally optional, never required).
   *
   * When provided, the connected-account join additionally requires
   * connected_accounts.team_id = teamId, so a thread on any other team
   * yields no row and the mirror is silently skipped (single -> returns
   * false; batch -> not counted), logged like any other "no mirror
   * context" case and never thrown.
   */
  teamId?: string;
}

/**
 * Best-effort Gmail system-label mirror for a SINGLE thread.
 *
 * Looks up the thread's gmail_thread_id and its connected account's
 * refresh token in one query, then calls modifyGmailThreadLabels with
 * the caller-supplied add/remove label ids. When opts.teamId is set,
 * the lookup also requires the connected account to be on that team.
 *
 * Returns true if a mirror was attempted (token + gmail_thread_id both
 * present, and team matched when teamId was given), false otherwise --
 * e.g. a thread that never had a gmail_thread_id because it predates
 * the Gmail integration, a missing token, or a team mismatch. A Gmail
 * API error is logged at warn and also returns false; it never throws,
 * because the engine state the caller already wrote is canonical.
 */
export async function mirrorThreadLabel(
  threadId: string,
  opts: MirrorThreadLabelOptions,
): Promise<boolean> {
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
      .where(
        and(
          eq(emailThreads.id, threadId),
          opts.teamId ? eq(connectedAccounts.teamId, opts.teamId) : undefined,
        ),
      )
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
      { err, threadId, context: opts.context },
      "mirrorThreadLabel failed (engine state already updated)",
    );
    return false;
  }
}

/**
 * Best-effort Gmail system-label mirror for a BATCH of threads.
 *
 * Resolves every thread's gmail_thread_id + token in one query (scoped
 * to opts.teamId when provided), then iterates because each thread may
 * live on a different connected account with its own token. A per-thread
 * failure is logged at warn and skipped; it does not abort the batch,
 * because engine state is canonical for the remaining threads.
 *
 * Returns the count of threads successfully mirrored. Callers typically
 * log this for observability rather than acting on it.
 */
export async function mirrorThreadLabelsBatch(
  threadIds: string[],
  opts: MirrorThreadLabelOptions,
): Promise<number> {
  if (threadIds.length === 0) return 0;
  if ((opts.addLabelIds?.length ?? 0) === 0 && (opts.removeLabelIds?.length ?? 0) === 0) {
    return 0;
  }
  const rows = await db
    .select({
      threadId: emailThreads.id,
      gmailThreadId: emailThreads.gmailThreadId,
      token: connectedAccounts.gmailOauthRefreshToken,
    })
    .from(emailThreads)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, emailThreads.staffOutreachEmailId))
    .where(
      and(
        inArray(emailThreads.id, threadIds),
        opts.teamId ? eq(connectedAccounts.teamId, opts.teamId) : undefined,
      ),
    );
  let ok = 0;
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
        "mirrorThreadLabelsBatch entry failed (engine state already updated)",
      );
    }
  }
  return ok;
}
